import glob
import re

for file in glob.glob('src/components/Mode*.jsx'):
    with open(file, 'r', encoding='utf-8') as f:
        content = f.read()

    # 1. Fix transcribe
    content = content.replace(
        'const { text } = await transcribeRes.json();\n      setTranscript(text);',
        'const { job_id: transcribeJobId } = await transcribeRes.json();\n      setQueueStatus(\'\');\n      const { text } = await pollJobStatus(apiBase, transcribeJobId, {}, 2500, 120000, setQueueStatus);\n      setTranscript(text);'
    )
    content = content.replace(
        'const { text: transcript } = await transcribeRes.json();',
        'const { job_id: transcribeJobId } = await transcribeRes.json();\n      setQueueStatus(\'\');\n      const { text: transcript } = await pollJobStatus(apiBase, transcribeJobId, {}, 2500, 120000, setQueueStatus);'
    )

    # 2. Fix grade
    content = content.replace(
        'const gradeData = await gradeRes.json();',
        'const { job_id: gradeJobId } = await gradeRes.json();\n      setQueueStatus(\'\');\n      const gradeData = await pollJobStatus(apiBase, gradeJobId, {}, 2500, 120000, setQueueStatus);'
    )
    content = content.replace(
        'const evalData = await gradeRes.json();',
        'const { job_id: gradeJobId } = await gradeRes.json();\n      setQueueStatus(\'\');\n      const evalData = await pollJobStatus(apiBase, gradeJobId, {}, 2500, 120000, setQueueStatus);'
    )

    # 3. Add queueStatus state if not there
    if 'setQueueStatus' not in content[:500]:  # roughly check top of component
        content = re.sub(
            r'(const \[isProcessing, setIsProcessing\] = useState\(false\);)',
            r'\1\n  const [queueStatus, setQueueStatus] = useState(\'\');',
            content
        )

    # 4. Import pollJobStatus
    if 'pollJobStatus' not in content[:300]:
        content = content.replace(
            'import api from \'../utils/api\';',
            'import api, { pollJobStatus } from \'../utils/api\';'
        )

    # 5. Fix UI spinners
    content = content.replace(
        '<Spinner message="Sending audio to Whisper for transcription..." />',
        '<Spinner message={queueStatus ? `[${queueStatus.toUpperCase()}] Transcribing...` : "Sending audio to Whisper for transcription..."} />'
    )

    content = content.replace(
        '<h3 className="text-xl font-bold text-white mb-2">Analyzing your speech...</h3>',
        '<h3 className="text-xl font-bold text-white mb-2">{queueStatus ? `[${queueStatus.toUpperCase()}] ` : \'\'}Analyzing your speech...</h3>'
    )

    with open(file, 'w', encoding='utf-8') as f:
        f.write(content)

print("Done patching components!")
