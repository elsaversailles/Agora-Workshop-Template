/**
 * VetAI Triage - Conversation Handler
 * Audio-only Agora integration for veterinary AI triage
 */

// Enable Agora SDK logging
AgoraRTC.enableLogUpload();

// UID for the user (0 means Agora will assign a random UID)
const USER_UID = 0;

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
const cancelEndBtn = document.getElementById('cancel-end');
const confirmEndBtn = document.getElementById('confirm-end');
const confirmModal = document.getElementById('confirm-modal');

// Pet info from session storage
let petInfo = null;

/**
 * Show toast notification
 */
function showToast(message, duration = 3000) {
  console.log(`Toast: ${message}`);
  // Create a simple toast notification
  const toast = document.createElement('div');
  toast.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: #333;
    color: white;
    padding: 10px 15px;
    border-radius: 5px;
    z-index: 1000;
    font-size: 14px;
  `;
  toast.textContent = message;
  document.body.appendChild(toast);
  
  setTimeout(() => {
    if (toast.parentNode) {
      toast.parentNode.removeChild(toast);
    }
  }, duration);
}

/**
 * Show loading overlay
 */
function showLoading(text = 'Loading...') {
  console.log(`Loading: ${text}`);
  // Update the audio status instead
  if (audioStatus) {
    audioStatus.textContent = text;
  }
}

/**
 * Hide loading overlay
 */
function hideLoading() {
  console.log('Loading complete');
  if (audioStatus) {
    audioStatus.textContent = 'Connected';
  }
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
    groq_Key = cfg.GROQ_KEY || null;
    tts_Minimax_Key = cfg.TTS_MINIMAX_KEY || null;
    tts_Minimax_GroupID = cfg.TTS_MINIMAX_GROUPID || null;
    
    if (agora_AppID) {
      options.appid = agora_AppID;
    }
    
    // Generate dynamic token for the channel
    const channelName = generateChannelName();
    const tokenRes = await fetch(`/api/token?channelName=${channelName}&uid=${USER_UID}&role=publisher`);
    const tokenData = await tokenRes.json();
    options.token = tokenData.token;
    agora_Token = tokenData.token;
    
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
    
    // Controls enabled (no UI buttons in this version)
    console.log("Media tracks ready");
    
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
    options.uid = 0; // Use 0 for auto-assigned UID
    
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
    
    // Generate token for AI agent (UID 10001)
    const aiTokenRes = await fetch(`/api/token?channelName=${options.channel}&uid=10001&role=publisher`);
    const aiTokenData = await aiTokenRes.json();
    const aiAgentToken = aiTokenData.token;
    
    // Clean up any existing agent with the same channel name
    console.log("Checking for existing AI agents...");
    try {
      const cleanupRes = await fetch(`/api/convo-ai/cleanup/${options.channel}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      });
      if (cleanupRes.ok) {
        console.log("Cleaned up existing AI agent");
        // Wait a bit for cleanup to complete
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch (e) {
      console.log("No existing agent to clean up");
    }
    
    const requestData = {
      name: options.channel,
      properties: {
        channel: options.channel,
        token: aiAgentToken, // AI agent's own token for UID 10001
        agent_rtc_uid: "10001", // AI agent user ID
        remote_rtc_uids: ["0"], // Subscribe to user (0 = any auto-assigned UID will be detected)
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
          max_idle_time: 120,
          enable_greeting: true, // Explicitly enable automatic greeting
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
      
      // If 409 conflict, try to stop the existing agent and retry
      if (response.status === 409) {
        console.log("Detected conflicting agent, attempting to stop it...");
        try {
          const errorData = JSON.parse(err);
          if (errorData.agent_id) {
            await fetch(`/api/convo-ai/agents/${errorData.agent_id}/leave`, {
              method: "POST",
              headers: { "Content-Type": "application/json" }
            });
            console.log("Stopped conflicting agent, retrying in 2 seconds...");
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // Retry starting the agent
            const retryResponse = await fetch("/api/convo-ai/start", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(requestData),
            });
            
            if (!retryResponse.ok) {
              const retryErr = await retryResponse.text();
              throw new Error(retryErr || retryResponse.statusText);
            }
            
            const retryData = await retryResponse.json();
            agoraConvoTaskID = retryData.agent_id;
            conversationStartTime = new Date();
            console.log("Vet Convo AI started successfully after retry!", retryData);
            return true;
          }
        } catch (retryError) {
          console.error("Retry failed:", retryError);
        }
      }
      
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
  
  return `You are a friendly and professional veterinary AI triage assistant conducting a structured assessment for a ${petType} named ${petName} (age: ${petAge}).

STRUCTURED TRIAGE PROTOCOL:
You will ask these 5 key questions in order, one at a time, waiting for complete responses:

1. "Let's start with some basic information. Can you tell me ${petName}'s breed and confirm their name for me?"
2. "Is ${petName} spayed or neutered? This helps me understand certain health risks."
3. "Does ${petName} have any existing medical conditions or chronic health issues I should know about?"
4. "Is ${petName} currently taking any medications, supplements, or special treatments?"
5. "Now, what is the main concern that brought you here today? Can you describe the specific symptoms or behaviors you've noticed with ${petName}?"

CONVERSATION GUIDELINES:
- Ask ONE question at a time and wait for the complete answer before proceeding
- After each answer, briefly acknowledge ("Thank you, that's helpful") then move to the next question
- Keep responses conversational and warm - pet owners are often worried
- Use simple, clear language - avoid medical jargon
- Keep responses concise (1-2 sentences max) for voice clarity  
- Do NOT use markdown, emojis, or special formatting - this is voice-only
- After all 5 questions, simply say "Thank you for providing that information about ${petName}. Goodbye!" and END the conversation immediately.

IMPORTANT: Do NOT provide any summary, diagnosis, or triage recommendations after the 5 questions. Only say thank you, goodbye, and end the call.

Remember: Be empathetic, professional, and focus on gathering clear information through the structured questions. After question 5, only say goodbye - no medical advice or analysis.`;
}

/**
 * Build greeting message based on pet info
 */
function buildGreetingMessage() {
  const petName = petInfo?.name || 'your pet';
  const petType = petInfo?.typeName || 'pet';
  
  return `Hello! I'm your AI veterinary triage assistant. I'm here to help assess your ${petType}'s health concerns. I'll ask you 5 important questions to better understand the situation. Let's start with some basic information. Can you tell me your pet's breed and confirm their name for me?`;
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
    const audioTrack = user.audioTrack;
    audioTrack.play();
    audioTrack.setVolume(100);
    console.log("Playing AI audio at volume 100 from UID:", uid);
    updateAudioIndicator('speaking');
    showToast('AI voice connected');
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
 * Play welcome TTS sequence using OpenAI TTS
 */
async function playWelcomeSequence() {
  try {
    showToast('Starting AI triage with voice assistant...');
    updateAudioIndicator('speaking');
    
    // Start the questioning sequence with OpenAI TTS
    await startOpenAIQuestioningSequence();
    
  } catch (error) {
    console.error('Error in welcome sequence:', error);
    showToast('Voice assistant ready! Please speak your concerns.');
    updateAudioIndicator('listening');
  }
}

/**
 * OpenAI TTS-based questioning sequence
 */
async function startOpenAIQuestioningSequence() {
  const questions = [
    "Hello! I'm your AI veterinary triage assistant. I'll ask you 5 important questions about your pet to better understand their health concerns.",
    "Question 1: What is your pet's name and breed?",
    "Question 2: Is your pet spayed or neutered?", 
    "Question 3: Does your pet have any existing medical conditions?",
    "Question 4: Is your pet currently taking any medications or supplements?",
    "Question 5: What is the main issue you are concerned about with your pet? Can you describe the symptoms?"
  ];
  
  const responses = [];
  
  for (let i = 0; i < questions.length; i++) {
    const questionNumber = i;
    const question = questions[i];
    
    try {
      // Update UI
      if (i === 0) {
        showToast('Welcome! Starting triage assessment...');
      } else {
        showToast(`Question ${i} of 5`);
      }
      
      // Play question using OpenAI TTS
      updateAudioIndicator('speaking');
      await playOpenAITTS(question);
      
      if (i === 0) {
        // Just introduction, short pause
        await new Promise(resolve => setTimeout(resolve, 2000));
        continue;
      }
      
      // Wait for voice response
      await new Promise(resolve => setTimeout(resolve, 1000));
      updateAudioIndicator('listening');
      showToast(`Listening for your answer...`);
      
      // Listen for response (simplified - just wait for reasonable time)
      const response = await waitForUserResponse(questionNumber);
      responses.push({
        question: question,
        timestamp: new Date().toISOString(),
        response: response
      });
      
      // Brief acknowledgment
      updateAudioIndicator('speaking');
      await playOpenAITTS("Thank you.");
      await new Promise(resolve => setTimeout(resolve, 1000));
      
    } catch (error) {
      console.error(`Error with question ${questionNumber}:`, error);
    }
  }
  
  // Final message
  updateAudioIndicator('speaking');
  await playOpenAITTS("Thank you for providing that information. Let me analyze your responses and create a triage summary for you.");
  
  // Generate triage summary
  const triageSummary = await generateTriageSummary(responses);
  
  // Store responses and summary
  sessionStorage.setItem('vetai_triage_responses', JSON.stringify(responses));
  sessionStorage.setItem('vetai_triage_summary', JSON.stringify(triageSummary));
  
  // Speak the summary
  await playOpenAITTS(triageSummary.spokenSummary);
  
  updateAudioIndicator('listening');
  showToast('Triage assessment complete! You can continue the conversation or end the session.');
  
  // Update UI with summary
  displayTriageSummary(triageSummary);
  
  updateAudioIndicator('listening');
  showToast('Triage complete! You can now ask additional questions.');
}

/**
 * Play TTS using OpenAI API
 */
async function playOpenAITTS(text) {
  try {
    if (!text || text.trim().length === 0) {
      return;
    }
    
    // Call server endpoint to generate TTS
    const response = await fetch('/api/openai-tts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: text,
        voice: 'nova', // Professional female voice
        model: 'tts-1'
      })
    });
    
    if (!response.ok) {
      throw new Error('TTS request failed');
    }
    
    // Get audio blob and play it
    const audioBlob = await response.blob();
    const audioUrl = URL.createObjectURL(audioBlob);
    
    return new Promise((resolve, reject) => {
      const audio = new Audio(audioUrl);
      
      audio.onended = () => {
        URL.revokeObjectURL(audioUrl);
        resolve();
      };
      
      audio.onerror = (error) => {
        console.error('Audio playback error:', error);
        URL.revokeObjectURL(audioUrl);
        reject(error);
      };
      
      audio.play().catch(error => {
        console.error('Audio play error:', error);
        reject(error);
      });
    });
    
  } catch (error) {
    console.error('OpenAI TTS error:', error);
    // Fallback to browser TTS
    return playTTSMessage(text);
  }
}

/**
 * Wait for user response with timeout
 */
async function waitForUserResponse(questionNumber) {
  return new Promise((resolve) => {
    let responseReceived = false;
    
    // Simple timeout-based approach
    const timeout = setTimeout(() => {
      if (!responseReceived) {
        responseReceived = true;
        resolve(`Response received for question ${questionNumber}`);
      }
    }, 15000); // 15 second timeout per question
    
    // If we have audio track, try to detect speech
    if (localTracks.audioTrack) {
      try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const mediaStreamTrack = localTracks.audioTrack.getMediaStreamTrack();
        const source = audioContext.createMediaStreamSource(new MediaStream([mediaStreamTrack]));
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        let voiceDetected = false;
        let silenceCount = 0;
        
        const checkAudio = () => {
          if (responseReceived) return;
          
          analyser.getByteFrequencyData(dataArray);
          const average = dataArray.reduce((sum, value) => sum + value, 0) / bufferLength;
          
          if (average > 25) { // Voice threshold
            voiceDetected = true;
            silenceCount = 0;
            showToast('Voice detected! Continue speaking...');
          } else if (voiceDetected) {
            silenceCount++;
            if (silenceCount > 50) { // ~5 seconds of silence
              responseReceived = true;
              clearTimeout(timeout);
              audioContext.close();
              resolve(`Voice response completed for question ${questionNumber}`);
              return;
            }
          }
          
          requestAnimationFrame(checkAudio);
        };
        
        checkAudio();
        
      } catch (error) {
        console.error('Audio monitoring error:', error);
      }
    }
  });
}

/**
 * Fallback TTS using browser Speech Synthesis
 */
async function playTTSMessage(text) {
  return new Promise((resolve, reject) => {
    if (!window.speechSynthesis) {
      console.log('TTS not supported, using console output:', text);
      resolve();
      return;
    }
    
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.9;
    utterance.pitch = 1.0;
    utterance.volume = 0.8;
    
    // Try to use a professional female voice
    const voices = speechSynthesis.getVoices();
    const preferredVoice = voices.find(voice => 
      voice.name.includes('Female') || 
      voice.name.includes('Samantha') || 
      voice.name.includes('Susan') ||
      (voice.lang.startsWith('en') && voice.name.includes('Google'))
    );
    
    if (preferredVoice) {
      utterance.voice = preferredVoice;
    }
    
    utterance.onend = () => {
      console.log('TTS finished:', text);
      resolve();
    };
    
    utterance.onerror = (event) => {
      console.error('TTS error:', event.error);
      resolve();
    };
    
    setTimeout(() => {
      speechSynthesis.speak(utterance);
    }, 100);
  });
}

/**
 * Generate intelligent triage summary based on collected responses
 */
async function generateTriageSummary(responses) {
  try {
    // Extract answers from responses
    const answers = responses.map(r => r.response || 'No response provided').join(' | ');
    
    // Create prompt for AI analysis
    const analysisPrompt = `As a veterinary AI triage assistant, analyze the following pet owner responses to create a comprehensive triage summary:

Pet Owner's Responses to 5 Key Questions:
1. Pet's name and breed
2. Spay/neuter status  
3. Existing medical conditions
4. Current medications/supplements
5. Main concern and symptoms

Responses: ${answers}

Create a structured triage assessment with:

1. URGENCY LEVEL (High/Medium/Low) based on symptoms
2. KEY FINDINGS from the responses
3. IMMEDIATE RECOMMENDATIONS
4. FOLLOW-UP ACTIONS

Format as JSON with:
- urgencyLevel: "High" | "Medium" | "Low" 
- urgencyReason: brief explanation
- keyFindings: array of main points
- recommendations: array of immediate actions
- followUpActions: array of next steps
- spokenSummary: 2-3 sentence summary to speak aloud

Consider emergency symptoms like difficulty breathing, bleeding, seizures, toxin exposure as HIGH urgency.
Persistent symptoms lasting days, eating issues, behavior changes as MEDIUM urgency.
Minor concerns, routine questions as LOW urgency.`;

    // Call AI analysis endpoint
    const response = await fetch('/api/analyze-triage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: analysisPrompt,
        responses: responses
      })
    });

    if (!response.ok) {
      throw new Error('Triage analysis failed');
    }

    const analysis = await response.json();
    
    return {
      timestamp: new Date().toISOString(),
      petInfo: petInfo,
      responses: responses,
      ...analysis
    };

  } catch (error) {
    console.error('Error generating triage summary:', error);
    
    // Fallback summary
    return {
      timestamp: new Date().toISOString(),
      petInfo: petInfo,
      responses: responses,
      urgencyLevel: 'Medium',
      urgencyReason: 'Unable to analyze - recommend veterinary consultation',
      keyFindings: ['Triage information collected', 'Analysis system unavailable'],
      recommendations: ['Contact your veterinarian for proper assessment'],
      followUpActions: ['Schedule veterinary appointment', 'Monitor pet closely'],
      spokenSummary: 'I have collected your information but cannot provide a detailed analysis at this time. I recommend contacting your veterinarian for a proper assessment of your pet\'s condition.'
    };
  }
}

/**
 * Display triage summary in the UI
 */
function displayTriageSummary(summary) {
  try {
    // Update the triage progress section to show results
    const triageProgress = document.getElementById('triage-progress');
    const triageSummarySection = document.getElementById('triage-summary');
    const triagePoints = document.getElementById('triage-points');
    const postTriageActions = document.getElementById('post-triage-actions');

    if (triageProgress) {
      triageProgress.style.display = 'none';
    }

    if (triageSummarySection) {
      triageSummarySection.style.display = 'block';
    }

    if (triagePoints) {
      // Create summary HTML
      const summaryHTML = `
        <li><strong>Urgency Level:</strong> ${summary.urgencyLevel} - ${summary.urgencyReason}</li>
        ${summary.keyFindings.map(finding => `<li><strong>Key Finding:</strong> ${finding}</li>`).join('')}
        ${summary.recommendations.map(rec => `<li><strong>Recommendation:</strong> ${rec}</li>`).join('')}
        ${summary.followUpActions.map(action => `<li><strong>Next Step:</strong> ${action}</li>`).join('')}
      `;
      
      triagePoints.innerHTML = summaryHTML;
    }

    if (postTriageActions) {
      postTriageActions.hidden = false;
      
      // Update the button based on urgency
      const bookVetBtn = document.getElementById('book-vet');
      if (bookVetBtn) {
        if (summary.urgencyLevel === 'High') {
          bookVetBtn.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Emergency Vet Now';
          bookVetBtn.className = 'vet-btn vet-btn-danger';
        } else if (summary.urgencyLevel === 'Medium') {
          bookVetBtn.innerHTML = '<i class="fas fa-user-md"></i> Schedule Vet Visit';
          bookVetBtn.className = 'vet-btn vet-btn-primary';
        } else {
          bookVetBtn.innerHTML = '<i class="fas fa-calendar"></i> Optional Checkup';
          bookVetBtn.className = 'vet-btn vet-btn-secondary';
        }
      }
    }

    // Show toast with urgency level
    showToast(`Triage Complete: ${summary.urgencyLevel} urgency level identified`);

  } catch (error) {
    console.error('Error displaying triage summary:', error);
    showToast('Triage summary generated - check the conversation for details');
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
  
  console.log(isMuted ? 'Microphone muted' : 'Microphone unmuted');
}

/**
 * Toggle video on/off
 */
function toggleVideo() {
  if (!localTracks.videoTrack) return;
  
  isVideoEnabled = !isVideoEnabled;
  localTracks.videoTrack.setEnabled(isVideoEnabled);
  
  console.log(isVideoEnabled ? 'Camera enabled' : 'Camera disabled');
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
    
    // Get the real triage summary if it exists
    const triageSummary = JSON.parse(sessionStorage.getItem('vetai_triage_summary') || 'null');
    
    // Store session data for summary page
    const sessionData = {
      petInfo: petInfo,
      startTime: conversationStartTime?.toISOString(),
      endTime: new Date().toISOString(),
      duration: conversationStartTime 
        ? Math.round((Date.now() - conversationStartTime.getTime()) / 1000) 
        : 0,
      // Use real triage summary if available, otherwise generate mock
      triageSummary: triageSummary,
      mockSummary: triageSummary ? null : generateMockSummary()
    };
    
    sessionStorage.setItem('vetai_session_data', JSON.stringify(sessionData));
    
    // Ensure the triage summary persists for the conversation page
    if (triageSummary) {
      sessionStorage.setItem('vetai_triage_ready', 'true');
    }
    
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
  // Build pet info from booking/session; do not redirect
  try {
    const bookingId = sessionStorage.getItem('vetai_active_booking');
    const bookings = JSON.parse(localStorage.getItem('vetai_bookings') || '[]');
    const booking = bookings.find(b => b.id === bookingId);
    const storedPet = sessionStorage.getItem('vetai_pet_info');
    petInfo = booking?.petInfo || (storedPet ? JSON.parse(storedPet) : null) || { emoji: '🐾', name: 'Your Pet', typeName: 'Pet', age: 'Age not specified' };
  } catch (e) {
    petInfo = { emoji: '🐾', name: 'Your Pet', typeName: 'Pet', age: 'Age not specified' };
  }
  petAvatar.textContent = petInfo.emoji || '🐾';
  petNameDisplay.textContent = petInfo.name || 'Your Pet';
  petTypeDisplay.textContent = `${petInfo.typeName || petInfo.type || 'Pet'} • ${petInfo.age || 'Age not specified'}`;

  showLoading('Connecting to AI assistant...');
  updateStatus('connecting', 'Connecting...');

  // Initialize speech synthesis voices
  if (window.speechSynthesis) {
    speechSynthesis.getVoices(); // Trigger voice loading
    if (speechSynthesis.onvoiceschanged !== undefined) {
      speechSynthesis.onvoiceschanged = () => {
        console.log('Speech synthesis voices loaded:', speechSynthesis.getVoices().length);
      };
    }
  }

  try {
    const configLoaded = await loadClientConfig();
    if (!configLoaded) throw new Error("Failed to load configuration");

    createClient();

    showLoading('Joining session...');
    const joined = await joinChannel();
    if (!joined) throw new Error("Failed to join channel");

    showLoading('Setting up camera and microphone...');
    const published = await createTracksAndPublish();
    if (!published) throw new Error("Failed to publish tracks");

    showLoading('Starting AI assistant...');
    const aiStarted = await startVetConvoAI();
    if (!aiStarted) throw new Error("Failed to start AI assistant");

    hideLoading();
    updateStatus('active', 'Connected');
    updateAudioIndicator('listening');
    
    // Play TTS greeting sequence
    await playWelcomeSequence();

  } catch (error) {
    console.error("Initialization error:", error);
    hideLoading();
    updateStatus('ended', 'Connection Failed');
    showToast("Failed to connect. Please try again.");

    setTimeout(() => {
      if (confirm("Connection failed. Retry?")) {
        window.location.reload();
      } else {
        window.location.href = 'index.html';
      }
    }, 1000);
  }
}

// Event Listeners
if (cancelEndBtn) {
  cancelEndBtn.addEventListener('click', () => {
    if (confirmModal) {
      confirmModal.style.display = 'none';
    }
  });
}

if (confirmEndBtn) {
  confirmEndBtn.addEventListener('click', () => {
    window.location.href = 'summary.html';
  });
}

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
