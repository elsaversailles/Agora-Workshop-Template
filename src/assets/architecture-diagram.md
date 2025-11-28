# VetAI Triage System Architecture

## System Architecture Diagram

```mermaid
graph TB
    subgraph "Client Browser"
        UI[HTML/CSS/JS UI]
        AgoraSDK[Agora Web SDK<br/>AgoraRTC]
    end

    subgraph "Node.js Server - Express"
        Express[Express Server<br/>Port 9001]
        TokenGen[Token Generator<br/>RtcTokenBuilder]
        ConfigAPI[Config API<br/>/config]
        ConvoProxy[Convo AI Proxy<br/>/api/convo-ai/*]
    end

    subgraph "Agora Platform"
        RTC[Agora RTC<br/>Real-time Audio Channel]
        ConvoAI[Agora Conversational AI<br/>REST API v2]
    end

    subgraph "AI Services"
        Groq[Groq LLM<br/>llama-3.3-70b-versatile<br/>OpenAI-compatible]
        Minimax[Minimax TTS<br/>WebSocket<br/>speech-2.6-turbo]
        OpenAI[OpenAI<br/>Alternative LLM]
        Bedrock[AWS Bedrock<br/>Alternative LLM]
    end

    subgraph "Authentication & Config"
        ENV[.env File<br/>API Keys & Secrets]
        Session[SessionStorage<br/>Client Session]
    end

    %% Client to Server
    UI -->|HTTP Requests| Express
    UI -->|Fetch Config| ConfigAPI
    UI -->|Request Token| TokenGen
    UI -->|Start/Stop Agent| ConvoProxy
    
    %% Client to Agora RTC
    AgoraSDK -->|Join Channel<br/>Publish Audio| RTC
    RTC -->|Subscribe Audio<br/>AI Responses| AgoraSDK
    
    %% Server to Agora
    TokenGen -->|Generate RTC Token| RTC
    ConvoProxy -->|Basic Auth<br/>Agent Lifecycle| ConvoAI
    
    %% Agora AI to Services
    ConvoAI -->|ASR + Text| Groq
    ConvoAI -.->|Alternative| OpenAI
    ConvoAI -.->|Alternative| Bedrock
    Groq -->|LLM Response| ConvoAI
    ConvoAI -->|Text to Synthesize| Minimax
    Minimax -->|Audio Stream| ConvoAI
    
    %% AI Agent to RTC
    ConvoAI -->|Publish AI Audio<br/>UID 10001| RTC
    RTC -->|User Audio<br/>UID 10000| ConvoAI
    
    %% Config
    ENV -->|Load Keys| Express
    ENV -->|Expose Safe Config| ConfigAPI
    Session -->|Store Pet Info| UI

    %% Styling
    classDef client fill:#e1f5ff,stroke:#01579b,stroke-width:2px
    classDef server fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef agora fill:#f3e5f5,stroke:#4a148c,stroke-width:2px
    classDef ai fill:#e8f5e9,stroke:#1b5e20,stroke-width:2px
    classDef config fill:#fce4ec,stroke:#880e4f,stroke-width:2px
    
    class UI,AgoraSDK client
    class Express,TokenGen,ConfigAPI,ConvoProxy server
    class RTC,ConvoAI agora
    class Groq,Minimax,OpenAI,Bedrock ai
    class ENV,Session config
```

## Component Details

### Client Layer
- **UI**: HTML/CSS/JS interface (vanilla JS + Bootstrap)
- **Agora Web SDK**: Real-time audio publishing and subscription

### Server Layer (Express)
- **Config API**: Exposes safe client configuration
- **Token Generator**: Creates Agora RTC tokens using `agora-token` library
- **Convo AI Proxy**: Proxies requests to Agora Conversational AI API
  - `/api/convo-ai/start` - Start AI agent
  - `/api/convo-ai/agents/:id/leave` - Stop agent
  - `/api/convo-ai/agents/:id/status` - Check agent status
  - `/api/convo-ai/webhook` - Receive AI events

### Agora Platform
- **RTC**: Real-time audio channel for user ↔ AI communication
- **Conversational AI**: Orchestrates ASR → LLM → TTS pipeline

### AI Services
- **Groq LLM**: Primary reasoning engine (llama-3.3-70b-versatile)
- **Minimax TTS**: Voice synthesis via WebSocket
- **OpenAI / Bedrock**: Alternative LLM options

## Authentication Flow

```mermaid
sequenceDiagram
    participant C as Client
    participant S as Server
    participant A as Agora RTC
    participant AI as Agora AI

    C->>S: Request /config
    S-->>C: Return AGORA_APPID + Safe Keys
    
    C->>S: Request /api/token?channel=X&uid=10000
    S->>S: Generate Token (RtcTokenBuilder)
    S-->>C: Return RTC Token
    
    C->>A: Join Channel with Token
    A-->>C: Joined Successfully
    
    C->>S: POST /api/convo-ai/start
    S->>AI: Create Agent (Basic Auth)
    AI-->>S: Agent ID + Status
    S-->>C: Agent Started
    
    AI->>A: Join Channel (UID 10001)
    A-->>C: AI Agent Joined
```

## Data Flow: User → AI → User

```mermaid
flowchart LR
    U[User Speaks] -->|Publish Audio| RTC[RTC Channel]
    RTC -->|Subscribe| AI[AI Agent<br/>UID 10001]
    AI -->|ASR| TXT[Text Transcription]
    TXT -->|Prompt| LLM[Groq LLM]
    LLM -->|Response Text| TTS[Minimax TTS]
    TTS -->|Audio Stream| AI
    AI -->|Publish Audio| RTC
    RTC -->|Subscribe| U2[User Hears]
    
    style U fill:#bbdefb
    style U2 fill:#bbdefb
    style RTC fill:#f3e5f5
    style AI fill:#c8e6c9
    style LLM fill:#fff9c4
    style TTS fill:#ffccbc
```

## Key Environment Variables

- `AGORA_APPID` - Agora project app ID
- `AGORA_APPCERTIFICATE` - For token generation
- `AGORA_REST_KEY` / `AGORA_REST_SECRET` - Conversational AI API auth
- `GROQ_KEY` - Groq LLM API key
- `TTS_MINIMAX_KEY` / `TTS_MINIMAX_GROUPID` - Minimax TTS credentials
- `OPENAI_KEY` - Alternative LLM (optional)
- `AVATAR_AKOOL_KEY` - Avatar service (optional)

## Tech Stack Summary

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js |
| Server | Express |
| Client | Vanilla JS + Bootstrap |
| RTC SDK | Agora Web SDK v4.x |
| AI Orchestration | Agora Conversational AI REST v2 |
| LLM | Groq (llama-3.3-70b) |
| TTS | Minimax (speech-2.6-turbo) |
| Auth | Agora Token + Basic Auth |
| Config | dotenv (.env) |
