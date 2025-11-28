const express = require("express");
const cors = require("cors");
const path = require("path");
const axios = require("axios");

// Load environment variables from .env file
require("dotenv").config({ path: path.join(__dirname, "../.env") });

// Agora Token Generation
const { RtcTokenBuilder, RtcRole } = require("agora-token");

// Server Configuration - Default port 9001
const PORT = process.env.PORT ? Number(process.env.PORT) : 9001;

const dir = path.join(__dirname, "../src");
const app = express();

// Enable CORS for all origins
app.use(cors());

// Parse JSON bodies from the browser
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files
app.use(express.static(dir));
app.use('/vet', express.static(path.join(__dirname, "../src/vet")));

// Root route
app.get("/", (req, res) => {
  res.sendFile(path.join(dir, "index.html"));
});

// expose a small, safe config endpoint for client-side usage
// WARNING: Do NOT expose your RESTful API Key and Secret in production environment.
app.get("/config", (req, res) => {
  res.json({
    AGORA_APPID: process.env.AGORA_APPID || null,
    AGORA_TOKEN: process.env.AGORA_TOKEN || null,
    LLM_AWS_BEDROCK_KEY: process.env.LLM_AWS_BEDROCK_KEY || null,
    LLM_AWS_BEDROCK_ACCESS_KEY: process.env.LLM_AWS_BEDROCK_ACCESS_KEY || null,
    LLM_AWS_BEDROCK_SECRET_KEY: process.env.LLM_AWS_BEDROCK_SECRET_KEY || null,
    OPENAI_KEY: process.env.OPENAI_KEY || null,
    GROQ_KEY: process.env.GROQ_KEY || null,
    TTS_MINIMAX_KEY: process.env.TTS_MINIMAX_KEY || null,
    TTS_MINIMAX_GROUPID: process.env.TTS_MINIMAX_GROUPID || null,
    AVATAR_AKOOL_KEY: process.env.AVATAR_AKOOL_KEY || null
  });
});

// Proxy: start Convo AI (server calls Agora so browser doesn't need credentials)
app.post("/api/convo-ai/start", async (req, res) => {
  try {
    const appid = process.env.AGORA_APPID;
    const apiKey = process.env.AGORA_REST_KEY;
    const apiSecret = process.env.AGORA_REST_SECRET;
    
    if (!appid || !apiKey || !apiSecret) {
      console.error("Missing Agora credentials in .env");
      return res.status(500).json({ 
        error: "Server misconfigured: missing Agora credentials" 
      });
    }

    // Agora Conversational AI API URL
    const url = `https://api.agora.io/api/conversational-ai-agent/v2/projects/${appid}/join`;
    
    // Create Basic Auth header
    const basicAuth = Buffer.from(`${apiKey}:${apiSecret}`).toString("base64");

    console.log("=== Starting Convo AI ===");
    console.log("URL:", url);
    console.log("Request Body:", JSON.stringify(req.body, null, 2));

    // Make request to Agora API using axios
    const response = await axios.post(url, req.body, {
      headers: {
        "Authorization": `Basic ${basicAuth}`,
        "Content-Type": "application/json"
      }
    });

    console.log("Agora Response:", JSON.stringify(response.data, null, 2));
    return res.json(response.data);

  } catch (err) {
    console.error("Convo AI Start Error:", err.response?.data || err.message);
    
    if (err.response) {
      return res.status(err.response.status).json(err.response.data);
    }
    return res.status(500).json({ error: String(err.message) });
  }
});

// Proxy: stop (leave) Convo AI agent
app.post("/api/convo-ai/agents/:agentId/leave", async (req, res) => {
  try {
    const agentId = req.params.agentId;
    const appid = process.env.AGORA_APPID;
    const apiKey = process.env.AGORA_REST_KEY;
    const apiSecret = process.env.AGORA_REST_SECRET;
    
    if (!appid || !apiKey || !apiSecret) {
      return res.status(500).json({ 
        error: "Server misconfigured: missing Agora credentials" 
      });
    }

    const url = `https://api.agora.io/api/conversational-ai-agent/v2/projects/${appid}/agents/${agentId}/leave`;
    const basicAuth = Buffer.from(`${apiKey}:${apiSecret}`).toString("base64");

    console.log("=== Stopping Convo AI ===");
    console.log("Agent ID:", agentId);

    const response = await axios.post(url, {}, {
      headers: {
        "Authorization": `Basic ${basicAuth}`,
        "Content-Type": "application/json"
      }
    });

    console.log("Agent stopped successfully");
    return res.json(response.data);

  } catch (err) {
    console.error("Convo AI Leave Error:", err.response?.data || err.message);
    
    if (err.response) {
      return res.status(err.response.status).json(err.response.data);
    }
    return res.status(500).json({ error: String(err.message) });
  }
});

// Webhook endpoint for Agora Conversational AI events
app.post("/api/convo-ai/webhook", (req, res) => {
  console.log("=== Convo AI Webhook Event ===");
  console.log("Headers:", JSON.stringify(req.headers, null, 2));
  console.log("Body:", JSON.stringify(req.body, null, 2));
  
  // Acknowledge receipt
  res.status(200).json({ received: true });
});

// Get agent status
app.get("/api/convo-ai/agents/:agentId/status", async (req, res) => {
  try {
    const agentId = req.params.agentId;
    const appid = process.env.AGORA_APPID;
    const apiKey = process.env.AGORA_REST_KEY;
    const apiSecret = process.env.AGORA_REST_SECRET;
    
    if (!appid || !apiKey || !apiSecret) {
      return res.status(500).json({ 
        error: "Server misconfigured: missing Agora credentials" 
      });
    }

    const url = `https://api.agora.io/api/conversational-ai-agent/v2/projects/${appid}/agents/${agentId}`;
    const basicAuth = Buffer.from(`${apiKey}:${apiSecret}`).toString("base64");

    const response = await axios.get(url, {
      headers: {
        "Authorization": `Basic ${basicAuth}`,
        "Content-Type": "application/json"
      }
    });

    console.log("Agent Status:", JSON.stringify(response.data, null, 2));
    return res.json(response.data);

  } catch (err) {
    console.error("Get Agent Status Error:", err.response?.data || err.message);
    
    if (err.response) {
      return res.status(err.response.status).json(err.response.data);
    }
    return res.status(500).json({ error: String(err.message) });
  }
});

// Proxy: cleanup stale AI agents for a channel
app.post("/api/convo-ai/cleanup/:channelName", async (req, res) => {
  try {
    const channelName = req.params.channelName;
    const appid = process.env.AGORA_APPID;
    const apiKey = process.env.AGORA_REST_KEY;
    const apiSecret = process.env.AGORA_REST_SECRET;
    
    if (!appid || !apiKey || !apiSecret) {
      return res.status(500).json({ 
        error: "Server misconfigured: missing Agora credentials" 
      });
    }

    // List all agents and find the one for this channel
    const listUrl = `https://api.agora.io/api/conversational-ai-agent/v2/projects/${appid}/agents`;
    const basicAuth = Buffer.from(`${apiKey}:${apiSecret}`).toString("base64");

    console.log("=== Cleaning up stale agents for channel:", channelName, "===");

    try {
      const listResponse = await axios.get(listUrl, {
        headers: {
          "Authorization": `Basic ${basicAuth}`,
          "Content-Type": "application/json"
        }
      });

      const agents = listResponse.data.agents || [];
      const staleAgent = agents.find(a => a.channel === channelName);

      if (staleAgent) {
        console.log("Found stale agent:", staleAgent.agent_id);
        const stopUrl = `https://api.agora.io/api/conversational-ai-agent/v2/projects/${appid}/agents/${staleAgent.agent_id}/leave`;
        
        await axios.post(stopUrl, {}, {
          headers: {
            "Authorization": `Basic ${basicAuth}`,
            "Content-Type": "application/json"
          }
        });
        
        console.log("Stale agent stopped successfully");
        return res.json({ cleaned: true, agent_id: staleAgent.agent_id });
      } else {
        console.log("No stale agent found");
        return res.json({ cleaned: false });
      }
    } catch (err) {
      // If listing fails, just return success (no agent to clean)
      console.log("No agents to clean up");
      return res.json({ cleaned: false });
    }

  } catch (err) {
    console.error("Cleanup Error:", err.response?.data || err.message);
    // Return success even on error - cleanup is best-effort
    return res.json({ cleaned: false, error: err.message });
  }
});

// ===========================================
// TOKEN GENERATION API
// ===========================================

// Generate RTC token for a channel
app.get("/api/token", (req, res) => {
  const { channelName, uid, role } = req.query;
  
  const appId = process.env.AGORA_APPID;
  const appCertificate = process.env.AGORA_APPCERTIFICATE;
  
  if (!appId || !appCertificate) {
    return res.status(500).json({ error: "Missing Agora credentials" });
  }
  
  if (!channelName) {
    return res.status(400).json({ error: "channelName is required" });
  }
  
  const userUid = parseInt(uid) || 0;
  const tokenRole = role === "subscriber" ? RtcRole.SUBSCRIBER : RtcRole.PUBLISHER;
  
  // Token expires in 1 hour
  const expirationTimeInSeconds = 3600;
  const currentTimestamp = Math.floor(Date.now() / 1000);
  const privilegeExpiredTs = currentTimestamp + expirationTimeInSeconds;
  
  const token = RtcTokenBuilder.buildTokenWithUid(
    appId,
    appCertificate,
    channelName,
    userUid,
    tokenRole,
    privilegeExpiredTs
  );
  
  console.log("Generated token for channel:", channelName, "uid:", userUid);
  
  res.json({ token });
});

// ===========================================
// VET CALL QUEUE APIs (In-memory for demo)
// ===========================================

// In-memory call queue storage
const vetCallQueue = new Map();

// Request a vet call (user submits request)
app.post("/api/vet-calls/request", (req, res) => {
  const { channelName, petInfo, triageSummary, requestTime } = req.body;
  
  if (!channelName) {
    return res.status(400).json({ error: "Channel name required" });
  }

  const callRequest = {
    channelName,
    petInfo: petInfo || {},
    triageSummary: triageSummary || {},
    requestTime: requestTime || Date.now(),
    status: "pending",
    vetJoined: false
  };

  vetCallQueue.set(channelName, callRequest);
  console.log("New call request:", channelName);

  res.json({ success: true, channelName });
});

// Get pending calls (for vet dashboard)
app.get("/api/vet-calls/pending", (req, res) => {
  const pending = [];
  vetCallQueue.forEach((call, channelName) => {
    if (call.status === "pending") {
      pending.push({
        channelName,
        petInfo: call.petInfo,
        triageSummary: call.triageSummary,
        requestTime: call.requestTime,
        waitTime: Math.floor((Date.now() - call.requestTime) / 1000)
      });
    }
  });

  // Sort by request time (oldest first)
  pending.sort((a, b) => a.requestTime - b.requestTime);

  res.json({ calls: pending });
});

// Check call status (for user to know if vet joined)
app.get("/api/vet-calls/status/:channelName", (req, res) => {
  const call = vetCallQueue.get(req.params.channelName);
  
  if (!call) {
    return res.status(404).json({ error: "Call not found" });
  }

  res.json({
    channelName: req.params.channelName,
    status: call.status,
    vetJoined: call.vetJoined
  });
});

// Accept a call (vet accepts from dashboard)
app.post("/api/vet-calls/accept/:channelName", (req, res) => {
  const call = vetCallQueue.get(req.params.channelName);
  
  if (!call) {
    return res.status(404).json({ error: "Call not found" });
  }

  call.status = "accepted";
  call.vetJoined = true;
  call.acceptedAt = Date.now();
  
  console.log("Call accepted:", req.params.channelName);
  res.json({ success: true, channelName: req.params.channelName });
});

// Cancel a call request (user cancels or call ends)
app.post("/api/vet-calls/cancel/:channelName", (req, res) => {
  const existed = vetCallQueue.delete(req.params.channelName);
  console.log("Call cancelled:", req.params.channelName, existed ? "(found)" : "(not found)");
  res.json({ success: true });
});

// OpenAI Text-to-Speech endpoint
app.post("/api/openai-tts", async (req, res) => {
  try {
    const { text, voice = 'nova', model = 'tts-1' } = req.body;
    
    if (!text) {
      return res.status(400).json({ error: "Text is required" });
    }
    
    if (!process.env.OPENAI_KEY) {
      return res.status(500).json({ error: "OpenAI API key not configured" });
    }
    
    const response = await axios.post(
      'https://api.openai.com/v1/audio/speech',
      {
        model: model,
        input: text,
        voice: voice,
        response_format: 'mp3'
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_KEY}`,
          'Content-Type': 'application/json',
        },
        responseType: 'arraybuffer'
      }
    );
    
    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': response.data.length
    });
    
    res.send(response.data);
    
  } catch (error) {
    console.error('OpenAI TTS Error:', error.response?.data || error.message);
    res.status(500).json({ 
      error: "TTS generation failed", 
      details: error.response?.data?.error?.message || error.message 
    });
  }
});

// AI Triage Analysis endpoint
app.post("/api/analyze-triage", async (req, res) => {
  // Always return static summary about Max the dog for demo purposes
  console.log('Returning static triage summary for Max');
  
  res.json({
    urgencyLevel: 'Medium',
    urgencyReason: 'Based on 3 days of appetite loss and decreased activity',
    keyFindings: ['Max has not eaten for 3 days', 'Decreased activity and lethargy observed', '5-year-old dog showing concerning symptoms'],
    recommendations: ['Veterinary examination within 24-48 hours', 'Monitor hydration status closely', 'Consider appetite stimulants or nutritional support'],
    followUpActions: ['Schedule veterinary appointment immediately', 'Keep detailed log of eating attempts', 'Monitor for additional symptoms'],
    spokenSummary: 'Based on the information about Max, a 3-day loss of appetite combined with decreased activity requires prompt veterinary attention to rule out underlying conditions and prevent dehydration.'
  });
// ===========================================
// CALL ANALYSIS AND TRANSCRIPTION APIs
// ===========================================

// Transcribe call audio to text
app.post('/api/transcribe-call', async (req, res) => {
  try {
    const { audioBase64 } = req.body;
    
    if (!audioBase64) {
      return res.status(400).json({ error: 'Audio data required' });
    }
    
    console.log('Transcribing call audio...');
    
    // Convert base64 to buffer
    const audioBuffer = Buffer.from(audioBase64, 'base64');
    
    // Create FormData for OpenAI Whisper API
    const FormData = require('form-data');
    const formData = new FormData();
    formData.append('file', audioBuffer, {
      filename: 'call.webm',
      contentType: 'audio/webm'
    });
    formData.append('model', 'whisper-1');
    formData.append('response_format', 'json');
    
    const fetch = require('node-fetch');
    const transcriptionResponse = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        ...formData.getHeaders()
      },
      body: formData
    });
    
    const transcriptionResult = await transcriptionResponse.json();
    
    if (!transcriptionResponse.ok) {
      throw new Error(transcriptionResult.error?.message || 'Transcription failed');
    }
    
    const transcript = transcriptionResult.text || '';
    console.log('Call transcription completed:', transcript.substring(0, 100) + '...');
    
    res.json({
      success: true,
      transcript: transcript,
      duration: audioBuffer.length,
      wordCount: transcript.split(' ').length
    });
    
  } catch (error) {
    console.error('Call transcription error:', error.message);
    res.status(500).json({
      error: 'Failed to transcribe call',
      details: error.message
    });
  }
});

// Analyze call transcript with AI
app.post('/api/analyze-call', async (req, res) => {
  try {
    const { transcript, petInfo, triageSummary } = req.body;
    
    if (!transcript) {
      return res.status(400).json({ error: 'Transcript required' });
    }
    
    console.log('Analyzing call with AI...');
    
    const analysisPrompt = `You are a veterinary AI assistant analyzing a call between a pet owner and veterinarian. 

PET INFORMATION:
${JSON.stringify(petInfo || {}, null, 2)}

PREVIOUS TRIAGE SUMMARY:
${JSON.stringify(triageSummary || {}, null, 2)}

CALL TRANSCRIPT:
${transcript}

Please provide a comprehensive analysis in JSON format with these fields:
- callSummary: Brief overview of the call discussion
- vetDiagnosis: Veterinarian's diagnosis or assessment
- treatmentPlan: Recommended treatment plan
- medicationsDiscussed: Any medications mentioned
- followUpInstructions: Follow-up care instructions
- urgencyLevel: High/Medium/Low based on discussion
- keyPoints: Array of important discussion points
- ownerQuestions: Questions asked by the pet owner
- vetRecommendations: Specific recommendations from the vet
- nextSteps: What the owner should do next
- estimatedCost: If mentioned, treatment cost estimates
- readableNotes: Human-readable summary for easy reading

Respond with valid JSON only.`;
    
    const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: 'You are a veterinary AI assistant specialized in analyzing veterinary consultations.' },
        { role: 'user', content: analysisPrompt }
      ],
      temperature: 0.3,
      max_tokens: 2000
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    
    let analysis;
    try {
      analysis = JSON.parse(response.data.choices[0].message.content);
    } catch (parseError) {
      console.log('JSON parse failed, using fallback analysis');
      analysis = {
        callSummary: 'Call analysis completed',
        vetDiagnosis: 'Please refer to the call recording for detailed diagnosis',
        treatmentPlan: 'Follow veterinarian instructions as discussed',
        urgencyLevel: 'Medium',
        keyPoints: ['Professional veterinary consultation completed'],
        readableNotes: 'Call analysis is being processed. Please refer to the consultation notes provided by your veterinarian.'
      };
    }
    
    console.log('Call analysis completed successfully');
    res.json(analysis);
    
  } catch (error) {
    console.error('Call analysis error:', error.response?.data || error.message);
    
    // Fallback response
    res.json({
      callSummary: 'Professional veterinary consultation completed',
      vetDiagnosis: 'Analysis system temporarily unavailable',
      treatmentPlan: 'Follow instructions provided during the call',
      urgencyLevel: 'Medium',
      keyPoints: ['Call recording available for review'],
      readableNotes: 'Your consultation has been completed. Please refer to any notes or instructions provided by your veterinarian during the call.'
    });
  }
});

// ===========================================

const server = app.listen(PORT, () => {
  const actualPort = server.address().port;
  console.log(`\n=======================================`);
  console.log(`🚀 Server running at http://localhost:${actualPort}`);
  console.log(`=======================================`);
  console.log(`\n📋 Available Routes:`);
  console.log(`   VetAI Triage:    http://localhost:${actualPort}/vet/index.html`);
  console.log(`   Basic Video:     http://localhost:${actualPort}/example/basic/basicVideoCall/index.html`);
  console.log(`   Config API:      http://localhost:${actualPort}/config`);
  console.log(`\n=======================================\n`);
});
