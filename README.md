# hrefSpeak - Automated English Speaking Assessment Platform

hrefSpeak is an AI-powered speaking practice and evaluation platform designed for students. It offers three interactive modes to practice and test English proficiency, with real-time logs saved to a shared Google Sheet leaderboard.

---

## Technical Stack
- **Frontend**: React (Vite) + Tailwind CSS + Web Speech API (TTS)
- **Backend**: Python FastAPI (Uvicorn)
- **Speech-to-Text**: Groq API (Whisper-Large-V3)
- **Conversational Tutor**: Groq API (Llama-3.3-70B)
- **Evaluator**: Google Gemini API (Gemini 2.5 Flash structured outputs)
- **Leaderboard Database**: Google Sheets API (`gspread`)

---

## Setup Instructions

### 1. API Keys configuration
Open the `backend/.env` file and replace the placeholders with your actual keys:
- **`GROQ_API_KEY`**: Obtain this from the [Groq Console](https://console.groq.com/).
- **`GEMINI_API_KEY`**: Obtain this from the [Google AI Studio Console](https://aistudio.google.com/).
- **`SPREADSHEET_ID`**: Pre-configured to your Google Sheet ID: `17Nsrz1nxHB1ujmkeUOB0nx6AEUkIqyoG__JMqFIqDpg`.

---

### 2. Google Sheets Service Account Setup
The backend uses a service account key to log student scores. Follow these steps:

1. **Create Google Cloud Project & Enable APIs**:
   - Go to the [Google Cloud Console](https://console.cloud.google.com/).
   - Create a new project (e.g., "AuraSpeak Leaderboard").
   - Search for **Google Sheets API** and click **Enable**.
   - Search for **Google Drive API** and click **Enable**.

2. **Create Service Account**:
   - In Cloud Console, go to **IAM & Admin** > **Service Accounts**.
   - Click **Create Service Account** (e.g., name it `auraspeak-logger`).
   - Leave permissions blank and click **Done**.

3. **Generate and Download Key**:
   - Click on your newly created service account.
   - Go to the **Keys** tab.
   - Click **Add Key** > **Create new key**.
   - Choose **JSON** format, then click **Create**.
   - A JSON file will download to your computer. Rename it exactly to `service_account.json`.

4. **Add to Project**:
   - Place this `service_account.json` file in the `backend/` directory of this workspace:
     `d:\Coding\english_speaking\backend\service_account.json`

5. **Share Your Google Sheet**:
   - Open your `service_account.json` and copy the `"client_email"` address (e.g., `hrefspeak-logger@...iam.gserviceaccount.com`).
   - Open your Google Sheet in the browser: [Leaderboard Sheet](https://docs.google.com/spreadsheets/d/17Nsrz1nxHB1ujmkeUOB0nx6AEUkIqyoG__JMqFIqDpg).
   - Click the **Share** button in the top right.
   - Paste the service account email, set the role to **Editor**, uncheck "Notify people", and click **Share**.

---

### 3. Run the Backend (FastAPI)
Open a terminal in the project root:

1. Create a Python virtual environment and activate it:
   ```bash
   # Windows (Command Prompt)
   python -m venv venv
   call venv\Scripts\activate

   # Windows (PowerShell)
   python -m venv venv
   .\venv\Scripts\Activate.ps1
   ```

2. Install backend dependencies:
   ```bash
   pip install -r backend/requirements.txt
   ```

3. Run the server:
   ```bash
   python backend/main.py
   ```
   The API will now be running on `http://localhost:8000`.

---

### 4. Run the Frontend (React + Vite)
Open a new terminal session in the project root:

1. Navigate to the `frontend/` folder:
   ```bash
   cd frontend
   ```

2. Start the Vite development server:
   ```bash
   npm run dev
   ```
   Open your browser and navigate to `http://localhost:5173` to start practicing!

---

## How It Works (Modes)

1. **Read Aloud**:
   - Pick a passage, press and hold the mic button, read, and release.
   - Whisper transcribes, and Gemini compares it against the source text.
   - Output: Accuracy score (0-100), Word Error Rate (WER), skipped words, mispronounced words, and actionable feedback.

2. **IELTS Q&A**:
   - Read the question card prompt.
   - Click the mic once to record, and click again to finish (designed for 1-2 min responses).
   - Output: IELTS band scores (1-9) for Fluency, Lexical Resource, Grammatical Range, Pronunciation, and examiner feedback.

3. **AI Conversation**:
   - Chat with the AI tutor (Llama-3.3-70B). The tutor answers audibly using native browser Text-to-Speech.
   - Maintain 3-5 speaking turns.
   - Click **End Conversation** to evaluate the complete transcript.
   - Output: IELTS band scores (1-9) for Fluency, Lexical, Grammar, Pronunciation, Interactive Communication, and overall dialogue feedback.

---

## 🚀 Free Deployment Guide

Follow these steps to deploy the entire application online for free:

### 1. Backend Deployment (Hugging Face Spaces)

1. Create a free account on [Hugging Face](https://huggingface.co/).
2. Click on your profile picture in the top-right and select **New Space**.
3. Configure your Space:
   - **Space Name**: `hrefspeak-api` (or any name you prefer)
   - **License**: `mit` (or choose yours)
   - **SDK**: Select **Docker**
   - **Template**: Select **Blank**
   - **Space Hardware**: CPU basic (2 vCPU, 16GB RAM) - **Free**
   - **Visibility**: Public (safe since we hide keys in Settings) or Private
4. Go to the **Settings** tab of your new Space, scroll to the **Variables and secrets** section, and add the following **Secrets** (do not add them as variables, secrets are encrypted and hidden from the public):
   - **`GROQ_API_KEY`**: Your Groq API key
   - **`GEMINI_API_KEY`**: Your Gemini API key
   - **`SPREADSHEET_ID`**: `17Nsrz1nxHB1ujmkeUOB0nx6AEUkIqyoG__JMqFIqDpg`
   - **`GOOGLE_SHEETS_CREDS_JSON`**: Open your local `service_account.json` file, copy the **entire JSON content**, and paste it here as the secret value.
5. Upload the backend files to the Space:
   - You can push the files using Git, or upload them directly using the files interface.
   - **Important**: Upload only the files inside the `backend/` folder directly to the root of the Space:
     - `main.py`
     - `requirements.txt`
     - `Dockerfile`
     - `utils/` (subfolder containing `__init__.py`, `ai.py`, `sheets.py`)
   - Do **NOT** upload your local `service_account.json` or `.env` files to the Space files repository (the secrets you set in step 4 will populate them securely!).
6. Hugging Face will automatically detect the `Dockerfile`, compile your container, and start the server. You can find your Space's public API URL by clicking the **three dots** in the top right > **Embed this Space** > copy the **Direct URL** (it looks like `https://username-space-name.hf.space`).

---

### 2. Frontend Deployment (Vercel)

1. Create a free account on [Vercel](https://vercel.com).
2. Connect Vercel to your GitHub repository, or deploy using the Vercel CLI:
   - Install CLI: `npm install -g vercel`
   - In your command line, navigate to the `frontend/` folder:
     ```bash
     cd frontend
     ```
   - Run the deploy command:
     ```bash
     vercel
     ```
3. During setup in Vercel:
   - Import the project.
   - Set the root directory of the project to `frontend/` (if deploying from a monorepo).
   - In **Environment Variables**, add:
     - **Name**: `VITE_API_BASE`
     - **Value**: Your Hugging Face Space direct URL (e.g., `https://username-space-name.hf.space`)
4. Click **Deploy**. Vercel will compile the React static assets and launch your site on a free `.vercel.app` subdomain!

