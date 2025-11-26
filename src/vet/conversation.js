/**
 * VetAI Triage - Conversation Handler
 * Audio-only Agora integration for veterinary AI triage
 */

// Enable Agora SDK logging
AgoraRTC.enableLogUpload();

// State variables
let client = null;
let localTracks = {
  audioTrack: null,
  videoTrack: null,
};
let remoteUsers = {};
let isVideoEnabled = true;
let options = {};
let agoraConvoTaskID = "";
let isMuted = false;
let conversationStartTime = null;
let conversationNotes = []; // Store key points from conversation

// API Keys (loaded from server)
let agora_AppID = null;
let agora_Token = null;
let groq_Key = null;
let tts_Minimax_Key = null;
let tts_Minimax_GroupID = null;

// DOM Elements
const petAvatar = document.getElementById('pet-avatar');
const petNameDisplay = document.getElementById('pet-name-display');
const petTypeDisplay = document.getElementById('pet-type-display');
const connectionStatus = document.getElementById('connection-status');
const audioIndicator = document.getElementById('audio-indicator');
const audioStatus = document.getElementById('audio-status');
const audioHint = document.getElementById('audio-hint');
const muteBtn = document.getElementById('mute-btn');
const videoBtn = document.getElementById('video-btn');
const endBtn = document.getElementById('end-btn');
const loadingOverlay = document.getElementById('loading-overlay');
const loadingText = document.getElementById('loading-text');
const toast = document.getElementById('toast');
const confirmModal = document.getElementById('confirm-modal');

// Pet info from session storage
let petInfo = null;

/**
 * Show toast notification
 */
function showToast(message, duration = 3000) {
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
  }, duration);
}

/**
 * Show loading overlay
 */
function showLoading(text = 'Loading...') {
  loadingText.textContent = text;
  loadingOverlay.style.display = 'flex';
}

/**
 * Hide loading overlay
 */
function hideLoading() {
  loadingOverlay.style.display = 'none';
}

/**
 * Update connection status UI
 */
function updateStatus(status, text) {
  connectionStatus.className = 'vet-status';
  connectionStatus.innerHTML = '';
  
  switch (status) {
    case 'connecting':
      connectionStatus.classList.add('vet-status-connecting');
      connectionStatus.innerHTML = `<i class="fas fa-circle-notch fa-spin"></i><span>${text}</span>`;
      break;
    case 'active':
      connectionStatus.classList.add('vet-status-active');
      connectionStatus.innerHTML = `<i class="fas fa-circle"></i><span>${text}</span>`;
      break;
    case 'ended':
      connectionStatus.classList.add('vet-status-ended');
      connectionStatus.innerHTML = `<i class="fas fa-circle"></i><span>${text}</span>`;
      break;
  }
}

/**
 * Update audio indicator UI
 */
function updateAudioIndicator(state) {
  audioIndicator.classList.remove('speaking', 'inactive');
  
  switch (state) {
    case 'speaking':
      audioIndicator.classList.add('speaking');
      audioStatus.textContent = 'AI is speaking...';
      audioHint.textContent = 'Listen to the AI assistant\'s response.';
      break;
    case 'listening':
      audioStatus.textContent = 'Listening...';
      audioHint.textContent = 'Speak clearly about your pet\'s symptoms.';
      break;
    case 'inactive':
      audioIndicator.classList.add('inactive');
      audioStatus.textContent = 'Session ended';
      audioHint.textContent = 'The conversation has ended.';
      break;
    default:
      audioStatus.textContent = 'Connected';
      audioHint.textContent = 'Start speaking to describe your pet\'s symptoms.';
  }
}

/**
 * Load configuration from server
 */
async function loadClientConfig() {
  try {
    const res = await fetch("/config");
    if (!res.ok) throw new Error("Failed to fetch /config");
    const cfg = await res.json();
    
    agora_AppID = cfg.AGORA_APPID || null;
    agora_Token = cfg.AGORA_TOKEN || null;
    groq_Key = cfg.GROQ_KEY || null;
    tts_Minimax_Key = cfg.TTS_MINIMAX_KEY || null;
    tts_Minimax_GroupID = cfg.TTS_MINIMAX_GROUPID || null;
    
    if (agora_AppID) {
      options.appid = agora_AppID;
    }
    options.token = agora_Token || null;
    
    console.log("Client config loaded successfully");
    return true;
  } catch (e) {
    console.error("Could not load client config:", e);
    showToast("Failed to load configuration. Please try again.");
    return false;
  }
}

/**
 * Generate a unique channel name
 * Note: If using a fixed token, the channel name must match what the token was generated for
 */
function generateChannelName() {
  // Using a fixed channel name to match the pre-generated token
  // If you have dynamic token generation, you can use random channel names
  return "vet-triage";
}

/**
 * Create Agora client
 */
function createClient() {
  client = AgoraRTC.createClient({
    mode: "rtc",
    codec: "vp8",
  });
  console.log("Agora client created");
}

/**
 * Create audio and video tracks and publish
 */
async function createTracksAndPublish() {
  try {
    // Create both audio and video tracks
    const [audioTrack, videoTrack] = await Promise.all([
      AgoraRTC.createMicrophoneAudioTrack({
        encoderConfig: "music_standard",
      }),
      AgoraRTC.createCameraVideoTrack()
    ]);
    
    localTracks.audioTrack = audioTrack;
    localTracks.videoTrack = videoTrack;
    
    // Play local video track
    localTracks.videoTrack.play("local-player", { mirror: true });
    
    // Publish both tracks to channel
    await client.publish(Object.values(localTracks));
    console.log("Audio and video tracks published successfully");
    
    // Enable control buttons
    muteBtn.disabled = false;
    videoBtn.disabled = false;
    
    return true;
  } catch (error) {
    console.error("Error creating tracks:", error);
    showToast("Failed to access camera/microphone. Please check permissions.");
    return false;
  }
}

/**
 * Join Agora channel
 */
async function joinChannel() {
  try {
    // Set up event handlers
    client.on("user-published", handleUserPublished);
    client.on("user-unpublished", handleUserUnpublished);
    client.on("user-left", handleUserLeft);
    
    // Generate unique channel name
    options.channel = generateChannelName();
    options.uid = 10000; // Local user ID
    
    // Join channel
    await client.join(
      options.appid,
      options.channel,
      options.token || null,
      options.uid
    );
    
    console.log("Joined channel:", options.channel);
    return true;
  } catch (error) {
    console.error("Error joining channel:", error);
    if (error.code === "CAN_NOT_GET_GATEWAY_SERVER") {
      showToast("Token error. Please check your configuration.");
    } else {
      showToast("Failed to join channel. Please try again.");
    }
    return false;
  }
}

/**
 * Start Agora Conversational AI with veterinary context
 */
async function startVetConvoAI() {
  try {
    if (!client || !options.channel) {
      throw new Error("Client not initialized");
    }
    
    // Build veterinary-specific system prompt
    const systemPrompt = buildVetSystemPrompt();
    const greetingMessage = buildGreetingMessage();
    
    const requestData = {
      name: options.channel,
      properties: {
        channel: options.channel,
        token: options.token || "", // Token for AI agent to join channel (from AGORA_TOKEN in .env)
        agent_rtc_uid: "10001", // AI agent user ID
        remote_rtc_uids: ["10000"], // Subscribe to local user
        idle_timeout: 120, // 2 minutes idle timeout
        advanced_features: {
          enable_aivad: true, // Enable intelligent interruption handling
          enable_mllm: false,
          enable_rtm: false,
        },
        asr: {
          language: "en-US",
        },
        llm: {
          url: "https://api.groq.com/openai/v1/chat/completions",
          api_key: groq_Key,
          system_messages: [
            {
              role: "system",
              content: systemPrompt,
            },
          ],
          greeting_message: greetingMessage,
          failure_message: "I'm sorry, I'm having technical difficulties. Please try again or consult a veterinarian directly.",
          params: {
            model: "llama-3.3-70b-versatile"
          }
        },
        tts: {
          vendor: "minimax",
          params: {
            url: "wss://api.minimax.io/ws/v1/t2a_v2",
            group_id: tts_Minimax_GroupID,
            key: tts_Minimax_Key,
            model: "speech-2.6-turbo",
            voice_setting: {
              voice_id: "English_Calm_Female_8", // Calm, professional voice for medical context
              speed: 0.95, // Slightly slower for clarity
              vol: 1,
              pitch: 0,
              emotion: "calm",
            },
            audio_setting: {
              sample_rate: 16000,
            },
          },
          skip_patterns: [3, 4],
        },
        // Avatar disabled for audio-only mode
        // When Akool key is fixed, this can be enabled
        avatar: {
          vendor: "akool",
          enable: false, // DISABLED - audio only mode
          params: {}
        },
        parameters: {
          silence_config: {
            timeout_ms: 15000, // 15 second silence timeout
            action: "think",
            content: "gently prompt user to continue"
          }
        }
      },
    };
    
    console.log("Starting Vet Convo AI...");
    const response = await fetch("/api/convo-ai/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestData),
    });
    
    if (!response.ok) {
      const err = await response.text();
      throw new Error(err || response.statusText);
    }
    
    const responseData = await response.json();
    agoraConvoTaskID = responseData.agent_id;
    conversationStartTime = new Date();
    
    console.log("Vet Convo AI started successfully!", responseData);
    return true;
  } catch (error) {
    console.error("Convo AI error:", error);
    showToast("Failed to start AI assistant. Please try again.");
    return false;
  }
}

/**
 * Build veterinary-specific system prompt
 */
function buildVetSystemPrompt() {
  const petType = petInfo?.typeName || 'pet';
  const petName = petInfo?.name || 'your pet';
  const petAge = petInfo?.age || 'unknown age';
  
  return `You are a friendly and professional veterinary AI triage assistant. You are helping assess a ${petType} named ${petName} (age: ${petAge}).

Your role is to:
1. Ask about the pet's symptoms in a conversational, caring manner
2. Gather relevant information (duration, severity, behavioral changes, eating/drinking habits)
3. Assess the urgency level based on symptoms
4. Provide appropriate recommendations

Guidelines:
- Be warm, empathetic, and reassuring - pet owners are often worried
- Ask one question at a time and wait for responses
- Use simple, non-medical language when possible
- Keep responses concise (2-3 sentences max) for voice clarity
- Do NOT use markdown, emojis, or special formatting - this is voice output
- Do NOT diagnose specific conditions - only triage and recommend next steps

Urgency Levels to determine:
- HIGH: Symptoms requiring immediate vet visit (difficulty breathing, severe bleeding, collapse, seizures, toxin ingestion, trauma)
- MEDIUM: Symptoms needing vet appointment within 24-48 hours (persistent vomiting, diarrhea, limping, loss of appetite for 2+ days)
- LOW: Minor concerns that can be monitored at home with guidance

After gathering enough information (usually 4-6 exchanges), provide a brief summary and recommendation.

Start by greeting the owner and asking about their main concern for ${petName}.`;
}

/**
 * Build greeting message based on pet info
 */
function buildGreetingMessage() {
  const petName = petInfo?.name || 'your pet';
  const petType = petInfo?.typeName || 'pet';
  
  return `Hello! I'm your AI veterinary assistant. I understand you're concerned about ${petName}, your ${petType}. I'm here to help assess the situation. Can you tell me what's been going on with ${petName}? What symptoms or behaviors have you noticed?`;
}

/**
 * Stop Agora Conversational AI
 */
async function stopConvoAI() {
  try {
    if (!agoraConvoTaskID) {
      console.log("No active agent to stop");
      return;
    }
    
    console.log("Stopping Convo AI...");
    const res = await fetch(`/api/convo-ai/agents/${agoraConvoTaskID}/leave`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || res.statusText);
    }
    
    console.log("Convo AI stopped successfully");
    agoraConvoTaskID = "";
  } catch (error) {
    console.error("Error stopping Convo AI:", error);
  }
}

/**
 * Leave channel and clean up
 */
async function leaveChannel() {
  try {
    // Stop local audio track
    if (localTracks.audioTrack) {
      localTracks.audioTrack.stop();
      localTracks.audioTrack.close();
      localTracks.audioTrack = null;
    }
    
    // Stop local video track
    if (localTracks.videoTrack) {
      localTracks.videoTrack.stop();
      localTracks.videoTrack.close();
      localTracks.videoTrack = null;
    }
    
    // Stop Convo AI
    await stopConvoAI();
    
    // Leave channel
    if (client) {
      await client.leave();
    }
    
    // Clear remote users
    remoteUsers = {};
    
    // Clear remote player list
    const remotePlayerList = document.getElementById('remote-playerlist');
    if (remotePlayerList) {
      remotePlayerList.innerHTML = '';
    }
    
    console.log("Left channel successfully");
  } catch (error) {
    console.error("Error leaving channel:", error);
  }
}

/**
 * Handle remote user published event
 */
async function handleUserPublished(user, mediaType) {
  const uid = user.uid;
  remoteUsers[uid] = user;
  
  // Subscribe to remote user
  await client.subscribe(user, mediaType);
  console.log("Subscribed to user:", uid, mediaType);
  
  if (mediaType === "audio") {
    user.audioTrack.play();
    updateAudioIndicator('speaking');
  }
  
  if (mediaType === "video") {
    // Create player div if it doesn't exist
    const remotePlayerList = document.getElementById('remote-playerlist');
    if (remotePlayerList && !document.getElementById(`player-${uid}`)) {
      const playerWrapper = document.createElement('div');
      playerWrapper.id = `player-wrapper-${uid}`;
      playerWrapper.className = 'remote-player-wrapper';
      
      const player = document.createElement('div');
      player.id = `player-${uid}`;
      player.className = 'remote-player';
      
      const playerName = document.createElement('div');
      playerName.className = 'remote-player-name';
      playerName.textContent = `AI Vet Assistant`;
      
      player.appendChild(playerName);
      playerWrapper.appendChild(player);
      remotePlayerList.appendChild(playerWrapper);
    }
    user.videoTrack.play(`player-${uid}`);
  }
}

/**
 * Handle remote user unpublished event
 */
function handleUserUnpublished(user, mediaType) {
  const uid = user.uid;
  console.log("User unpublished:", uid, mediaType);
  
  if (mediaType === "audio") {
    updateAudioIndicator('listening');
  }
  
  if (mediaType === "video") {
    const playerWrapper = document.getElementById(`player-wrapper-${uid}`);
    if (playerWrapper) {
      playerWrapper.remove();
    }
  }
}

/**
 * Handle user left event
 */
function handleUserLeft(user) {
  const uid = user.uid;
  delete remoteUsers[uid];
  console.log("User left:", uid);
  
  // Remove video player if exists
  const playerWrapper = document.getElementById(`player-wrapper-${uid}`);
  if (playerWrapper) {
    playerWrapper.remove();
  }
}

/**
 * Toggle microphone mute
 */
function toggleMute() {
  if (!localTracks.audioTrack) return;
  
  isMuted = !isMuted;
  localTracks.audioTrack.setEnabled(!isMuted);
  
  // Update UI
  muteBtn.classList.toggle('muted', isMuted);
  muteBtn.innerHTML = isMuted 
    ? '<i class="fas fa-microphone-slash"></i>' 
    : '<i class="fas fa-microphone"></i>';
  
  showToast(isMuted ? 'Microphone muted' : 'Microphone unmuted');
}

/**
 * Toggle video on/off
 */
function toggleVideo() {
  if (!localTracks.videoTrack) return;
  
  isVideoEnabled = !isVideoEnabled;
  localTracks.videoTrack.setEnabled(isVideoEnabled);
  
  // Update UI
  videoBtn.classList.toggle('disabled', !isVideoEnabled);
  videoBtn.innerHTML = isVideoEnabled 
    ? '<i class="fas fa-video"></i>' 
    : '<i class="fas fa-video-slash"></i>';
  
  showToast(isVideoEnabled ? 'Camera enabled' : 'Camera disabled');
}

/**
 * End conversation and go to summary
 */
async function endConversation() {
  showLoading('Ending session...');
  
  try {
    // Leave channel
    await leaveChannel();
    
    // Update UI
    updateStatus('ended', 'Session Ended');
    updateAudioIndicator('inactive');
    
    // Store session data for summary page
    const sessionData = {
      petInfo: petInfo,
      startTime: conversationStartTime?.toISOString(),
      endTime: new Date().toISOString(),
      duration: conversationStartTime 
        ? Math.round((Date.now() - conversationStartTime.getTime()) / 1000) 
        : 0,
      // Mock data for now since AI transcript isn't captured
      mockSummary: generateMockSummary()
    };
    
    sessionStorage.setItem('vetai_session_data', JSON.stringify(sessionData));
    
    // Redirect to summary page
    setTimeout(() => {
      window.location.href = 'summary.html';
    }, 1000);
  } catch (error) {
    console.error("Error ending conversation:", error);
    hideLoading();
    showToast("Error ending session. Please try again.");
  }
}

/**
 * Generate mock summary data (since AI transcript isn't captured)
 */
function generateMockSummary() {
  const petName = petInfo?.name || 'Your pet';
  const petType = petInfo?.typeName || 'pet';
  
  // Mock data for demonstration
  return {
    symptoms: [
      "Decreased appetite for 2 days",
      "Lethargy and less playful than usual",
      "Occasional vomiting (twice in 24 hours)"
    ],
    assessment: `Based on the symptoms described, ${petName} appears to be experiencing mild gastrointestinal discomfort. While not immediately life-threatening, these symptoms warrant attention.`,
    urgency: "medium", // low, medium, high
    recommendations: [
      `Monitor ${petName}'s eating and drinking closely`,
      "Offer small amounts of bland food (boiled chicken and rice)",
      "Ensure fresh water is always available",
      "Schedule a vet appointment within 24-48 hours if symptoms persist",
      "Seek immediate care if vomiting becomes more frequent or contains blood"
    ],
    followUp: "A veterinarian has been notified and will review this case. You can expect a response within 24 hours for non-urgent cases."
  };
}

/**
 * Initialize the conversation
 */
async function initConversation() {
  // Check for pet info
  const savedPetInfo = sessionStorage.getItem('vetai_pet_info');
  if (!savedPetInfo) {
    showToast("Please provide pet information first");
    window.location.href = 'pet-form.html';
    return;
  }
  
  try {
    petInfo = JSON.parse(savedPetInfo);
    
    // Update pet info display
    petAvatar.textContent = petInfo.emoji || '🐾';
    petNameDisplay.textContent = petInfo.name || 'Your Pet';
    petTypeDisplay.textContent = `${petInfo.typeName || 'Pet'} • ${petInfo.age || 'Age not specified'}`;
  } catch (e) {
    console.error("Error parsing pet info:", e);
    window.location.href = 'pet-form.html';
    return;
  }
  
  showLoading('Connecting to AI assistant...');
  updateStatus('connecting', 'Connecting...');
  
  try {
    // Load configuration
    const configLoaded = await loadClientConfig();
    if (!configLoaded) {
      throw new Error("Failed to load configuration");
    }
    
    // Create client
    createClient();
    
    // Join channel
    loadingText.textContent = 'Joining session...';
    const joined = await joinChannel();
    if (!joined) {
      throw new Error("Failed to join channel");
    }
    
    // Create and publish audio/video tracks
    loadingText.textContent = 'Setting up camera and microphone...';
    const published = await createTracksAndPublish();
    if (!published) {
      throw new Error("Failed to publish tracks");
    }
    
    // Start Convo AI
    loadingText.textContent = 'Starting AI assistant...';
    const aiStarted = await startVetConvoAI();
    if (!aiStarted) {
      throw new Error("Failed to start AI assistant");
    }
    
    // Success!
    hideLoading();
    updateStatus('active', 'Connected');
    updateAudioIndicator('listening');
    showToast('Connected! Start speaking to the AI assistant.');
    
  } catch (error) {
    console.error("Initialization error:", error);
    hideLoading();
    updateStatus('ended', 'Connection Failed');
    showToast("Failed to connect. Please try again.");
    
    // Offer retry option
    setTimeout(() => {
      if (confirm("Connection failed. Would you like to try again?")) {
        window.location.reload();
      } else {
        window.location.href = 'index.html';
      }
    }, 1000);
  }
}

// Event Listeners
muteBtn.addEventListener('click', toggleMute);
videoBtn.addEventListener('click', toggleVideo);

endBtn.addEventListener('click', () => {
  confirmModal.style.display = 'flex';
});

document.getElementById('cancel-end').addEventListener('click', () => {
  confirmModal.style.display = 'none';
});

document.getElementById('confirm-end').addEventListener('click', () => {
  confirmModal.style.display = 'none';
  endConversation();
});

// Handle page unload
window.addEventListener('beforeunload', async (e) => {
  if (agoraConvoTaskID) {
    await stopConvoAI();
  }
});

// Handle Agora autoplay blocked
AgoraRTC.onAutoplayFailed = () => {
  showToast("Click anywhere to enable audio playback");
  document.addEventListener('click', () => {
    // Audio will auto-resume after click
  }, { once: true });
};

// Handle microphone device changes
AgoraRTC.onMicrophoneChanged = async (changedDevice) => {
  if (!localTracks.audioTrack) return;
  
  if (changedDevice.state === "ACTIVE") {
    localTracks.audioTrack.setDevice(changedDevice.device.deviceId);
    showToast("Microphone changed");
  } else if (changedDevice.device.label === localTracks.audioTrack.getTrackLabel()) {
    const mics = await AgoraRTC.getMicrophones();
    if (mics[0]) {
      localTracks.audioTrack.setDevice(mics[0].deviceId);
    }
  }
};

// Handle camera device changes
AgoraRTC.onCameraChanged = async (changedDevice) => {
  if (!localTracks.videoTrack) return;
  
  if (changedDevice.state === "ACTIVE") {
    localTracks.videoTrack.setDevice(changedDevice.device.deviceId);
    showToast("Camera changed");
  } else if (changedDevice.device.label === localTracks.videoTrack.getTrackLabel()) {
    const cams = await AgoraRTC.getCameras();
    if (cams[0]) {
      localTracks.videoTrack.setDevice(cams[0].deviceId);
    }
  }
};

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', initConversation);
