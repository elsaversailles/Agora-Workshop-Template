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
