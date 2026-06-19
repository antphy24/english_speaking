import os
from typing import List, Optional
from pydantic import BaseModel, Field
from google import genai
from google.genai import types
from groq import Groq
from dotenv import load_dotenv

load_dotenv()

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

# Initialize clients lazily to avoid startup crashes if keys are not set yet
_groq_client = None
_gemini_client = None

def get_groq_client():
    global _groq_client
    if _groq_client is None:
        api_key = os.getenv("GROQ_API_KEY")
        if not api_key or api_key == "YOUR_GROQ_API_KEY":
            raise ValueError("GROQ_API_KEY is not set or is invalid in .env")
        _groq_client = Groq(api_key=api_key)
    return _groq_client

def get_gemini_client():
    global _gemini_client
    if _gemini_client is None:
        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key or api_key == "YOUR_GEMINI_API_KEY":
            raise ValueError("GEMINI_API_KEY is not set or is invalid in .env")
        _gemini_client = genai.Client(api_key=api_key)
    return _gemini_client

# --- Pydantic Schemas for Gemini Structured JSON output ---

class ReadAloudEvaluation(BaseModel):
    accuracy_score: int = Field(..., description="Accuracy score from 0 to 100 based on comparison to the source text")
    word_error_rate: float = Field(..., description="Word Error Rate (WER) as a float between 0.0 and 1.0 (or higher if extra words read)")
    skipped_words: List[str] = Field(..., description="List of words present in source text but skipped by student")
    mispronounced_words: List[str] = Field(..., description="List of words present in transcript but pronounced incorrectly compared to source text")
    feedback: str = Field(..., description="Detailed constructive feedback analyzing the student's read aloud performance")

class QAEvaluation(BaseModel):
    fluency: int = Field(..., description="IELTS Speaking Band score (1 to 9) for Fluency and Coherence")
    lexical_resource: int = Field(..., description="IELTS Speaking Band score (1 to 9) for Lexical Resource")
    grammatical_range: int = Field(..., description="IELTS Speaking Band score (1 to 9) for Grammatical Range and Accuracy")
    pronunciation: int = Field(..., description="IELTS Speaking Band score (1 to 9) for Pronunciation")
    feedback: str = Field(..., description="Detailed constructive feedback matching IELTS rubrics and suggestions for improvement")

class ConversationEvaluation(BaseModel):
    fluency_and_coherence: int = Field(..., description="IELTS Speaking Band score (1 to 9) for Fluency and Coherence")
    lexical_resource: int = Field(..., description="IELTS Speaking Band score (1 to 9) for Lexical Resource")
    grammatical_range: int = Field(..., description="IELTS Speaking Band score (1 to 9) for Grammatical Range and Accuracy")
    pronunciation: int = Field(..., description="IELTS Speaking Band score (1 to 9) for Pronunciation")
    interactive_communication: int = Field(..., description="IELTS Speaking Band score (1 to 9) for Interactive Communication")
    feedback: str = Field(..., description="Detailed feedback on the entire conversation history, identifying strengths and weaknesses")


# --- Service Functions ---

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

def get_llama_chat_reply(messages: List[dict]) -> str:
    """
    Generate next chatbot turn using Groq Llama-3.3-70B.
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
        model="llama-3.3-70b-versatile",
        messages=formatted_messages,
        temperature=0.7,
        max_tokens=150
    )
    return completion.choices[0].message.content

def evaluate_read_aloud(source_text: str, student_transcript: str) -> ReadAloudEvaluation:
    """
    Evaluate Read Aloud mode using Gemini 2.5 Flash structured output.
    """
    client = get_gemini_client()
    
    prompt = (
        f"Analyze the student's read aloud attempt.\n\n"
        f"Original text: \"{source_text}\"\n"
        f"Student's transcript: \"{student_transcript}\"\n\n"
        f"Compare the student's transcript with the original text.\n"
        f"Identify:\n"
        f"1. Words skipped by the student.\n"
        f"2. Words mispronounced, misspelled or substituted.\n"
        f"3. Calculate accuracy score (0-100) and Word Error Rate (WER).\n"
        f"4. Provide actionable feedback to help them improve."
    )
    
    response = client.models.generate_content(
        model='gemini-2.5-flash',
        contents=prompt,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=ReadAloudEvaluation,
            temperature=0.1
        )
    )
    # The return content is guaranteed to match the schema
    return ReadAloudEvaluation.model_validate_json(response.text)

def evaluate_qa(question: str, student_transcript: str) -> QAEvaluation:
    """
    Evaluate Q&A mode using Gemini 2.5 Flash structured output.
    """
    client = get_gemini_client()
    
    prompt = (
        f"Act as an official IELTS Speaking examiner grading a candidate.\n\n"
        f"Question prompt: \"{question}\"\n"
        f"Candidate's response: \"{student_transcript}\"\n\n"
        f"Evaluate the candidate's response using the IELTS assessment rubrics:\n"
        f"- Fluency and Coherence (fluency score: 1 to 9)\n"
        f"- Lexical Resource (vocabulary score: 1 to 9)\n"
        f"- Grammatical Range and Accuracy (grammar score: 1 to 9)\n"
        f"- Pronunciation (pronunciation score: 1 to 9)\n\n"
        f"Give the scores and provide detailed feedback on their strengths and weaknesses, "
        f"with recommendations to score higher."
    )
    
    response = client.models.generate_content(
        model='gemini-2.5-flash',
        contents=prompt,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=QAEvaluation,
            temperature=0.2
        )
    )
    return QAEvaluation.model_validate_json(response.text)

def evaluate_conversation(messages: List[dict]) -> ConversationEvaluation:
    """
    Evaluate multi-turn conversation using Gemini 2.5 Flash structured output.
    """
    client = get_gemini_client()
    
    # Format the messages transcript for Gemini
    formatted_transcript = ""
    for msg in messages:
        role_label = "Student" if msg["role"] == "user" else "AI Tutor"
        formatted_transcript += f"{role_label}: {msg['content']}\n"
        
    prompt = (
        f"Act as an official IELTS Speaking examiner. Evaluate the student's multi-turn conversational performance "
        f"with the AI Tutor based on the following transcript:\n\n"
        f"{formatted_transcript}\n"
        f"Rate the student's performance from 1 to 9 on each of the following IELTS criteria:\n"
        f"- Fluency and Coherence (fluency_and_coherence score)\n"
        f"- Lexical Resource (lexical_resource score)\n"
        f"- Grammatical Range and Accuracy (grammatical_range score)\n"
        f"- Pronunciation (pronunciation score - note that since this is a text transcript, base this on phonetic signals, punctuation indicators, or assume a baseline grade of 6-7 if no clear errors, but evaluate based on general fluency cues)\n"
        f"- Interactive Communication (interactive_communication score - how well the student responds to the AI prompts, keeps the conversation going, and handles turn-taking)\n\n"
        f"Provide detailed constructive feedback highlighting their conversational ability and grammatical accuracy."
    )
    
    response = client.models.generate_content(
        model='gemini-2.5-flash',
        contents=prompt,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=ConversationEvaluation,
            temperature=0.2
        )
    )
    return ConversationEvaluation.model_validate_json(response.text)
