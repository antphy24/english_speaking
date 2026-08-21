import os
import re
import tempfile
from typing import List, Optional
from pydantic import BaseModel, Field
import instructor
from groq import Groq
from dotenv import load_dotenv
from tenacity import retry, wait_exponential, stop_after_attempt, stop_after_delay, retry_if_exception
load_dotenv()

GROQ_API_KEY = os.getenv("GROQ_API_KEY")

# Initialize clients lazily to avoid startup crashes if keys are not set yet
import time
import redis

redis_url = os.getenv("REDIS_URL", "redis://localhost:6379")
redis_kwargs = {}
if redis_url.startswith('rediss://'):
    redis_kwargs['ssl_cert_reqs'] = None
redis_conn = redis.from_url(redis_url, **redis_kwargs)

_groq_client = None
_groq_client_created_at = 0
CLIENT_TTL = 1800  # 30 minutes

def get_groq_client():
    global _groq_client, _groq_client_created_at
    now = time.time()
    if _groq_client is None or (now - _groq_client_created_at > CLIENT_TTL):
        api_key = os.getenv("GROQ_API_KEY")
        if not api_key or api_key == "YOUR_GROQ_API_KEY":
            raise ValueError("GROQ_API_KEY is not set or is invalid in .env")
        raw_client = Groq(api_key=api_key)
        _groq_client = instructor.from_groq(raw_client, mode=instructor.Mode.MD_JSON)
        _groq_client_created_at = now
    return _groq_client

def call_groq_json(prompt, schema, temperature=0.1):
    """
    Wrapper for Groq API calls using instructor to guarantee JSON schema, and catches rate limits proactively.
    """
    client = get_groq_client()
    
    # Groq's JSON mode requires the prompt to explicitly mention JSON.
    # Without this, the model may generate empty strings resulting in validation errors.
    prompt_with_json_instruction = prompt + "\n\nYou must respond with a valid JSON object."
    
    try:
        response = client.chat.completions.create(
            model="qwen/qwen3.6-27b",
            messages=[{"role": "user", "content": prompt_with_json_instruction}],
            response_model=schema,
            temperature=temperature,
            max_retries=2,
            max_tokens=2048
        )
        return response
    except Exception as e:
        err_str = str(e)
        if "429" in err_str or "rate limit" in err_str.lower():
            import re
            match = re.search(r'(?:try again in|retry in) (\d+(?:\.\d+)?)s', err_str, re.IGNORECASE)
            ttl = int(float(match.group(1))) + 5 if match else 60
            redis_conn.setex("ai_quota_exhausted", ttl, "true")
        raise

# --- Pydantic Schemas for Structured JSON output ---

class ReadAloudEvaluation(BaseModel):
    accuracy_score: int = Field(..., description="Accuracy score from 0 to 100 based on comparison to the source text")
    word_error_rate: float = Field(..., description="Word Error Rate (WER) as a float between 0.0 and 1.0 (or higher if extra words read)")
    skipped_words: List[str] = Field(..., description="List of words present in source text but skipped by student (max 30 words)")
    mispronounced_words: List[str] = Field(..., description="List of words present in transcript but pronounced incorrectly compared to source text (max 30 words)")
    feedback: str = Field(..., description="Detailed constructive feedback analyzing the student's read aloud performance")

class QAEvaluation(BaseModel):
    fluency: int = Field(..., description="Score (0 to 100) for Fluency and Coherence")
    lexical_resource: int = Field(..., description="Score (0 to 100) for Lexical Resource")
    grammatical_range: int = Field(..., description="Score (0 to 100) for Grammatical Range and Accuracy")
    pronunciation: int = Field(..., description="Score (0 to 100) for Pronunciation")
    feedback: str = Field(..., description="Detailed constructive feedback and suggestions for improvement")

class ConversationEvaluation(BaseModel):
    fluency_and_coherence: int = Field(..., description="Score (0 to 100) for Fluency and Coherence")
    lexical_resource: int = Field(..., description="Score (0 to 100) for Lexical Resource")
    grammatical_range: int = Field(..., description="Score (0 to 100) for Grammatical Range and Accuracy")
    pronunciation: int = Field(..., description="Score (0 to 100) for Pronunciation")
    interactive_communication: int = Field(..., description="Score (0 to 100) for Interactive Communication")
    feedback: str = Field(..., description="Detailed feedback on the entire conversation history, identifying strengths and weaknesses")

class DebateEvaluation(BaseModel):
    matter_score: int = Field(..., description="Score 1-10 for Substance & Argumentation (Matter)")
    manner_score: int = Field(..., description="Score 1-10 for Rhetoric & Delivery (Manner)")
    method_score: int = Field(..., description="Score 1-10 for Structure & Responsiveness (Method)")
    matter_feedback: str = Field(..., description="Detailed feedback on argumentation, logic, and evidence (Matter)")
    manner_feedback: str = Field(..., description="Detailed feedback on pronunciation, vocabulary, grammar, and delivery (Manner)")
    method_feedback: str = Field(..., description="Detailed feedback on structure, time management, and responsiveness (Method)")
    overall_feedback: str = Field(..., description="Overall summary highlighting main strengths and actionable improvements")



# --- Service Functions ---

@retry(wait=wait_exponential(multiplier=1, min=2, max=10), stop=(stop_after_attempt(5) | stop_after_delay(120)))
def transcribe_audio_bytes(audio_bytes: bytes, filename: str) -> str:
    """
    Transcribe raw audio bytes using Groq Whisper.
    """
    client = get_groq_client()
    # Groq needs a tuple of (filename, file_bytes) or an open file-like object
    response = client.audio.transcriptions.create(
        file=(filename, audio_bytes),
        model="whisper-large-v3",
        language="en",
        response_format="json"
    )
    return response.text


def transcribe_audio_from_file(file_path: str, filename: str) -> str:
    """
    Read audio from a temp file on disk, transcribe it, then clean up.
    Designed for RQ workers to avoid passing large byte payloads through Redis.
    """
    try:
        with open(file_path, 'rb') as f:
            audio_bytes = f.read()
        return transcribe_audio_bytes(audio_bytes, filename)
    finally:
        # Always clean up the temp file
        try:
            os.unlink(file_path)
        except OSError:
            pass

@retry(wait=wait_exponential(multiplier=1, min=2, max=10), stop=(stop_after_attempt(5) | stop_after_delay(120)))
def get_chat_reply(messages: List[dict]) -> str:
    """
    Generate next chatbot turn using Groq Qwen 3.6-27B.
    """
    client = get_groq_client()
    system_prompt = (
        "You are an encouraging, professional, and friendly native English conversation partner. "
        "Your goal is to help the user practice their speaking. Keep your replies natural, brief (1-3 sentences), "
        "and always end with an engaging, easy-to-answer follow-up question related to the topic."
    )
    
    formatted_messages = [{"role": "system", "content": system_prompt}]
    for msg in messages:
        formatted_messages.append({
            "role": msg["role"],
            "content": msg["content"]
        })
        
    completion = client.chat.completions.create(
        model="qwen/qwen3.6-27b",
        messages=formatted_messages,
        temperature=0.7,
        max_tokens=150,
        response_model=None
    )
    return completion.choices[0].message.content

def evaluate_read_aloud(source_text: str, student_transcript: str) -> ReadAloudEvaluation:
    """
    Evaluate Read Aloud mode using Groq GPT-OSS-120B structured output.
    """
    
    prompt = (
        f"Analyze the student's read aloud attempt.\n\n"
        f"Original text: \"{source_text}\"\n"
        f"Student's transcript: \"{student_transcript}\"\n\n"
        f"Compare the student's transcript with the original text.\n"
        f"Identify:\n"
        f"1. Words skipped by the student (list up to a maximum of 30 words).\n"
        f"2. Words mispronounced, misspelled or substituted (list up to a maximum of 30 words).\n"
        f"3. Calculate accuracy score (0-100) and Word Error Rate (WER).\n"
        f"4. Provide actionable feedback to help them improve. IMPORTANT: Speak directly to the student using 'you' and 'your' (e.g., 'You did a great job...', 'Your pronunciation...'). DO NOT speak in the third person."
    )
    response = call_groq_json(prompt, ReadAloudEvaluation, temperature=0.1)
    if hasattr(response, "model_dump"):
        return response.model_dump()
    return response

def evaluate_qa(question: str, student_transcript: str) -> QAEvaluation:
    """
    Evaluate Q&A mode using Groq GPT-OSS-120B structured output.
    """
    
    prompt = (
        f"Act as an official IELTS Speaking examiner grading a candidate.\n\n"
        f"Question prompt: \"{question}\"\n"
        f"Candidate's response: \"{student_transcript}\"\n\n"
        f"Evaluate the candidate's response and provide a score from 0 to 100 for each of the following criteria:\n"
        f"- Fluency and Coherence (fluency score: 0 to 100)\n"
        f"- Lexical Resource (vocabulary score: 0 to 100)\n"
        f"- Grammatical Range and Accuracy (grammar score: 0 to 100)\n"
        f"- Pronunciation (pronunciation score: 0 to 100)\n\n"
        f"Give the scores and provide detailed feedback on their strengths and weaknesses, "
        f"with recommendations to score higher. IMPORTANT: Speak directly to the candidate using 'you' and 'your' (e.g., 'You did a great job...'). DO NOT speak in the third person."
    )
    
    response = call_groq_json(prompt, QAEvaluation, temperature=0.2)
    if hasattr(response, "model_dump"):
        return response.model_dump()
    return response

def evaluate_conversation(messages: List[dict]) -> ConversationEvaluation:
    """
    Evaluate multi-turn conversation using Groq GPT-OSS-120B structured output.
    """
    
    # Format the messages transcript for Gemini
    formatted_transcript = ""
    for msg in messages:
        role_label = "Student" if msg["role"] == "user" else "AI Tutor"
        formatted_transcript += f"{role_label}: {msg['content']}\n"
        
    prompt = (
        f"Act as an official IELTS Speaking examiner. Evaluate the student's multi-turn conversational performance "
        f"with the AI Tutor based on the following transcript:\n\n"
        f"{formatted_transcript}\n"
        f"Rate the student's performance from 0 to 100 on each of the following criteria:\n"
        f"- Fluency and Coherence (fluency_and_coherence score)\n"
        f"- Lexical Resource (lexical_resource score)\n"
        f"- Grammatical Range and Accuracy (grammatical_range score)\n"
        f"- Pronunciation (pronunciation score - note that since this is a text transcript, base this on phonetic signals, punctuation indicators, or assume a baseline grade if no clear errors, but evaluate based on general fluency cues)\n"
        f"- Interactive Communication (interactive_communication score - how well the student responds to the AI prompts, keeps the conversation going, and handles turn-taking)\n\n"
        f"Provide detailed constructive feedback highlighting their conversational ability and grammatical accuracy. IMPORTANT: Speak directly to the student using 'you' and 'your' (e.g., 'You did a great job...'). DO NOT speak in the third person."
    )
    
    response = call_groq_json(prompt, ConversationEvaluation, temperature=0.2)
    if hasattr(response, "model_dump"):
        return response.model_dump()
    return response

def evaluate_debate(motion: str, role: str, student_transcript: str) -> DebateEvaluation:
    """
    Evaluate debate performance using Groq GPT-OSS-120B structured output with strict grading.
    """
    
    prompt = (
        f"Act as a strict and professional Debate Adjudicator. Evaluate the speaker's performance.\n\n"
        f"Motion: \"{motion}\"\n"
        f"Role: \"{role}\"\n"
        f"Candidate's Speech Transcript: \"{student_transcript}\"\n\n"
        f"Evaluate the speech using the following strict standard debate rubric. DO NOT be generous. Penalize heavily for missing structure, lack of depth, and filler words.\n\n"
        f"1. Substance & Argumentation (Matter) — Rate 1 to 10\n"
        f"   - 8–10: Argumen memiliki struktur AEL (Assertion, Explanation, Link-back) atau AREEI yang sangat jelas. Respons langsung menjawab akar mosi, menggunakan analogi/bukti relevan, dan menjelaskan impact mendalam.\n"
        f"   - 5–7: Argumen jelas dan masuk akal, tetapi struktur penjelasan kurang mendalam/melompat-lompat. Bukti terlalu umum atau kurang kuat kaitannya.\n"
        f"   - 1–4: Hanya menyampaikan pernyataan tanpa penjelasan logis. Argumen tidak relevan atau melenceng.\n\n"
        f"2. Rhetoric & Delivery (Manner) — Rate 1 to 10\n"
        f"   - 8–10: Pengucapan sangat jelas. Intonasi dan penekanan dinamis. Kosakata bervariasi, grammar sangat minim kesalahan, filler words (uhm, ah, like) sangat sedikit.\n"
        f"   - 5–7: Berbicara lancar tapi intonasi cenderung datar. Beberapa kesalahan grammar dasar. Beberapa filler words muncul saat berpikir.\n"
        f"   - 1–4: Terlalu banyak jeda lama atau didominasi filler words. Pengucapan sulit dipahami atau struktur kalimat sangat berantakan.\n\n"
        f"3. Structure & Responsiveness (Method) — Rate 1 to 10\n"
        f"   - 8–10: Alur pidato sangat sistematis (pengantar, poin argumen, kesimpulan). Penggunaan waktu efisien.\n"
        f"   - 5–7: Struktur ada, tetapi transisi terasa kasar/mendadak. Manajemen waktu kurang pas.\n"
        f"   - 1–4: Pidato tidak terstruktur, melompat tanpa arah jelas. Tidak ada signposting.\n\n"
        f"Provide the scores (1-10) and detailed, rigorous feedback for Matter, Manner, and Method. Be critical and strict. IMPORTANT: Speak directly to the debater using 'you' and 'your' (e.g., 'You structured your argument well...'). DO NOT speak in the third person."
    )
    
    response = call_groq_json(prompt, DebateEvaluation, temperature=0.2)
    if hasattr(response, "model_dump"):
        return response.model_dump()
    return response
