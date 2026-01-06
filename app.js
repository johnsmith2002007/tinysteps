// Frank - Assignment Helper App

// Conversation modes - use config if available, otherwise fallback
// Config-driven from FRANK_CONFIG.conversationModes
// SINGLE MODE RULE: Each turn operates in exactly one mode only
const MODES = (typeof FRANK_CONFIG !== 'undefined' && FRANK_CONFIG.conversationModes) 
    ? FRANK_CONFIG.conversationModes
    : {
        LISTENING: 'listening',
        CLARIFYING: 'clarifying',
        OFFERING_DIRECTION: 'offering_direction',
        CALMING: 'calming',
        STEPPING: 'stepping',
        // Legacy mappings
        SHRINKING: 'offering_direction',
        PAUSED: 'calming',
        UNDERSTANDING: 'listening'
    };

class AssignmentHelper {
    constructor() {
        this.savedAssignments = this.loadSavedAssignments();
        this.currentAssignment = null;
        this.currentProgress = null;
        this.funFactTimer = null;
        this.conversationState = null; // Track question-answer flow for resilience help
        
        // Single source of truth for conversation state
        this.conversationMode = null; // Uses MODES constant
        this.lastUserInput = null; // Store last user input for contextual responses
        this.conversationContext = []; // Track conversation history for context
        
        this.init();
        this.checkPermissionCard();
        this.initFunFacts();
    }
    
    // Set conversation mode (single source of truth)
    setConversationMode(mode) {
        const validModes = Object.values(MODES);
        if (validModes.includes(mode)) {
            this.conversationMode = mode;
        }
    }
    
    /**
     * Detect certainty level from user input
     * Uses config-driven markers from FRANK_CONFIG.reasoning.certaintyHandling
     */
    detectCertaintyLevel(userInput) {
        if (!userInput) return 'medium';
        
        // Safety check for config
        if (typeof FRANK_CONFIG === 'undefined' || !FRANK_CONFIG.reasoning || !FRANK_CONFIG.reasoning.certaintyHandling) {
            console.warn('FRANK_CONFIG not available, using fallback certainty detection');
            return 'medium';
        }
        
        const lowerInput = userInput.toLowerCase();
        const certaintyConfig = FRANK_CONFIG.reasoning.certaintyHandling;
        
        // Check for high certainty first (stronger signal)
        if (certaintyConfig.highCertaintyMarkers && 
            certaintyConfig.highCertaintyMarkers.some(marker => lowerInput.includes(marker))) {
            return 'high';
        }
        
        // Check for low certainty
        if (certaintyConfig.lowCertaintyMarkers && 
            certaintyConfig.lowCertaintyMarkers.some(marker => lowerInput.includes(marker))) {
            return 'low';
        }
        
        // Default to medium for neutral statements
        return 'medium';
    }
    
    // Classify user input into signal types
    // Uses config-driven patterns from FRANK_CONFIG.inputClassification
    classifyInput(userInput) {
        const lowerInput = userInput.toLowerCase();
        
        // Safety check for config
        if (typeof FRANK_CONFIG === 'undefined' || !FRANK_CONFIG.inputClassification) {
            console.warn('FRANK_CONFIG not available, using fallback classification');
            // Fallback to basic classification
            const certaintyLevel = 'medium';
            if (userInput.split(' ').length < 10) {
                return { type: 'emotional', input: userInput, certaintyLevel };
            }
            return { type: 'ready_for_action', input: userInput, certaintyLevel };
        }
        
        const classificationConfig = FRANK_CONFIG.inputClassification;
        
        // Detect certainty level for proportional response matching
        const certaintyLevel = this.detectCertaintyLevel(userInput);
        
        // DOBROWSKI: Distinguish between loss of function (actual overwhelm) and intensity (strong emotion)
        // Check for loss of function first (highest priority - requires pause)
        const dobrowskiConfig = (typeof FRANK_CONFIG !== 'undefined' && FRANK_CONFIG.reasoning && 
                                 FRANK_CONFIG.reasoning.dobrowskiPrinciples && 
                                 FRANK_CONFIG.reasoning.dobrowskiPrinciples.enabled) 
                                 ? FRANK_CONFIG.reasoning.dobrowskiPrinciples.intensityAsInformation 
                                 : null;
        
        if (dobrowskiConfig && dobrowskiConfig.lossOfFunctionSignals) {
            if (dobrowskiConfig.lossOfFunctionSignals.some(signal => lowerInput.includes(signal))) {
                return { type: 'overwhelmed', input: userInput, certaintyLevel, hasLossOfFunction: true };
            }
        }
        
        // Check for intensity without loss of function (strong emotion but still functional)
        if (dobrowskiConfig && dobrowskiConfig.intensityOnlySignals) {
            if (dobrowskiConfig.intensityOnlySignals.some(signal => lowerInput.includes(signal))) {
                return { type: 'intense_emotion', input: userInput, certaintyLevel, hasLossOfFunction: false };
            }
        }
        
        // Fallback: Check for traditional overwhelm signals (if Dobrowski not enabled or no match)
        if (classificationConfig.overwhelmSignals && 
            classificationConfig.overwhelmSignals.some(signal => lowerInput.includes(signal))) {
            return { type: 'overwhelmed', input: userInput, certaintyLevel, hasLossOfFunction: false };
        }
        
        // Check for request to shrink
        if (classificationConfig.shrinkSignals && 
            classificationConfig.shrinkSignals.some(signal => lowerInput.includes(signal))) {
            return { type: 'request_to_shrink', input: userInput, certaintyLevel };
        }
        
        // IMPORTANT: If we're already in CLARIFYING mode and user responds, they've clarified
        // Transition to action mode (this takes priority over re-classifying as explanatory)
        if (this.conversationMode === MODES.CLARIFYING) {
            // User has answered the clarifying question - they're ready for action
            if (userInput.trim().length > 0) {
                return { type: 'ready_for_action', input: userInput, certaintyLevel };
            }
        }
        
        // Check for explanatory patterns (only if NOT already in clarifying mode)
        // This prevents getting stuck in a loop of clarification
        if (this.conversationMode !== MODES.CLARIFYING) {
            if (classificationConfig.explanatoryPatterns && 
                classificationConfig.explanatoryPatterns.some(pattern => pattern.test(userInput))) {
                return { type: 'explanatory', input: userInput, certaintyLevel };
            }
        }
        
        // Check for emotional indicators
        if (classificationConfig.emotionalKeywords && 
            classificationConfig.emotionalKeywords.some(keyword => lowerInput.includes(keyword))) {
            return { type: 'emotional', input: userInput, certaintyLevel };
        }
        
        // Check for action-oriented (assignment) input
        if (classificationConfig.assignmentKeywords && 
            classificationConfig.assignmentKeywords.some(keyword => lowerInput.includes(keyword))) {
            return { type: 'ready_for_action', input: userInput, certaintyLevel };
        }
        
        // Default: treat as emotional if short, otherwise as ready for action
        if (userInput.split(' ').length < 10) {
            return { type: 'emotional', input: userInput, certaintyLevel };
        }
        
        return { type: 'ready_for_action', input: userInput, certaintyLevel };
    }
    
    // GUARDRAIL: Detect if user explicitly signals overwhelm/shutdown
    // Calming/grounding language should ONLY be shown when:
    // 1. User explicitly signals overwhelm (e.g., "too much", "can't", "stressed", "overwhelmed")
    // 2. User selects a "pause" or "this is too much" option
    // Do NOT show calming language for informational/explanatory inputs like:
    // - "it's irrelevant"
    // - "this feels pointless"
    // - "I don't care about this"
    detectsOverwhelmSignal(input) {
        if (!input) return false;
        const lowerInput = input.toLowerCase();
        
        // First, check if this is an informational/explanatory input (NOT overwhelm)
        // These should NOT trigger calming language
        const informationalPatterns = [
            'irrelevant', 'pointless', 'doesn\'t matter', 'doesnt matter', 'don\'t care', 'dont care',
            'boring', 'useless', 'waste', 'not important', 'not relevant', 'doesn\'t make sense',
            'doesnt make sense', 'no point', 'why do i need', 'why do we need'
        ];
        
        // If input is purely informational/explanatory (no overwhelm signals), return false
        const isInformational = informationalPatterns.some(pattern => lowerInput.includes(pattern));
        if (isInformational) {
            // Only return true if it ALSO contains explicit overwhelm signals
            // This prevents informational inputs from triggering calming language
            const explicitOverwhelmSignals = [
                'too much', 'can\'t', 'cannot', 'overwhelmed', 'stressed', 'anxious',
                'panic', 'shut down', 'frozen', 'paralyzed', 'can\'t think', 'can\'t process',
                'brain won\'t work', 'mind is blank', 'can\'t focus', 'can\'t function',
                'completely stuck', 'nothing works', 'can\'t do anything', 'i give up',
                'i\'m done', 'im done', 'i can\'t do this', 'i cannot do this'
            ];
            const hasExplicitOverwhelm = explicitOverwhelmSignals.some(signal => lowerInput.includes(signal));
            if (!hasExplicitOverwhelm) {
                return false; // Informational input without explicit overwhelm = no calming language
            }
        }
        
        // Explicit overwhelm signals (from config or hardcoded fallback)
        const overwhelmSignals = [
            'i can\'t', 'i cannot', 'too much', 'too hard', 'i give up',
            'this is too much', 'can\'t do this', 'cannot do this',
            'shutdown', 'shut down', 'freeze', 'frozen', 'stuck', 'trapped',
            'i\'m done', 'im done', 'can\'t handle', 'cannot handle'
        ];
        return overwhelmSignals.some(signal => lowerInput.includes(signal));
    }
    
    /*
     * CONVERSATION AND TONE RULES
     * 
     * Frank must operate in exactly one conversation mode per turn (listening, clarifying, 
     * shrinking, stepping, paused). A single response may not mix modes.
     * 
     * Frank may ask only one question per turn.
     * 
     * TONE RULES (remove if present):
     * - Generic acknowledgements like "Thanks", "That's okay", "Here's a good place to start"
     * - Premature regulation language such as "Take a breath", "Pause for a moment", or 
     *   "You don't have to fix everything" unless the user explicitly signals overwhelm
     * - Multi-directional guidance (no reassurance + steps + questions together)
     * 
     * REQUIRED ELEMENTS:
     * Every response must include either:
     * - A mirror using the user's own language, OR
     * - A permission-based statement (e.g. "We don't have to fix this yet.")
     * 
     * ACTION BUTTONS:
     * - Must be contextual to the last user input
     * - Do not show "Make this smaller" or "Start this step" unless the user has indicated readiness
     * 
     * CERTAINTY AND PROPORTIONALITY RULES:
     * 
     * 1. DEGREE OF CERTAINTY MATCHING:
     *    - Low certainty input ("I think", "maybe", "it feels like") → tentative language ("might", "could be")
     *    - High certainty input ("I hate", "this is pointless") → direct acknowledgment, no challenging
     *    - Never assume more certainty than user provides
     * 
     * 2. COMMON SENSE REASONING:
     *    - Don't escalate support beyond what situation calls for (no grounding for mild frustration)
     *    - Don't introduce new problem framings user didn't imply (don't turn "irrelevant" into stress management)
     *    - Prefer simplest plausible interpretation of user intent
     *    - If human friend would say "yeah, that makes sense" before helping, Frank should too
     * 
     * 3. PROPORTIONAL RESPONSE:
     *    - Mild annoyance → simple reflection
     *    - Confusion → clarification
     *    - Explicit overwhelm → reassurance + pause (nothing more)
     *    - Readiness → action
     *    - Never stack: reassurance + instruction + regulation in same turn
     * 
     * 4. LANGUAGE CONSTRAINTS:
     *    - Avoid absolute claims unless user used absolute language
     *    - Avoid "solutions" before understanding the problem
     *    - Prefer mirrors over interpretations
     */
    
    // Canonical response flow
    // SINGLE MODE RULE: Each turn operates in exactly one mode only
    // Modes: LISTENING, CLARIFYING, OFFERING_DIRECTION, CALMING, STEPPING
    // Each mode has specific allowed elements:
    // - LISTENING: message only (no question, no actions)
    // - CLARIFYING: message + question only (no actions)
    // - OFFERING_DIRECTION: message + actions only (no question)
    // - CALMING: message + pause actions only (no question, no other actions)
    // - STEPPING: steps/actions only (no question, no reassurance)
    // PROPORTIONALITY RULE: Response intensity must match user's emotional/cognitive load
    // - Mild annoyance → simple reflection
    // - Confusion → clarification
    // - Explicit overwhelm → reassurance + pause
    // - Readiness → action
    // Never stack: reassurance + instruction + regulation in same turn
    generateFrankResponse(userInput, context = {}) {
        const signal = this.classifyInput(userInput);
        this.lastUserInput = userInput;
        
        // Extract certainty level for proportional response matching
        const certaintyLevel = signal.certaintyLevel || 'medium';
        
        // Ensure conversationContext is initialized (safety check)
        if (!Array.isArray(this.conversationContext)) {
            this.conversationContext = [];
        }
        
        // Add to conversation context
        this.conversationContext.push({
            input: userInput,
            signal: signal.type,
            certaintyLevel: certaintyLevel,
            timestamp: Date.now()
        });
        
        // STATE MACHINE: After Frank asks a question, next input is assumed to be an answer
        // UNLESS it clearly introduces a new topic
        const introducesNewTopic = this.introducesNewTopic(userInput, context);
        const wasInClarifyingMode = this.conversationMode === MODES.CLARIFYING;
        const hadPreviousQuestion = this.conversationContext.length > 0 && 
                                   this.conversationContext[this.conversationContext.length - 1]?.hadQuestion;
        
        // If we were in CLARIFYING mode and user input doesn't introduce new topic, treat as answer
        if (wasInClarifyingMode && !introducesNewTopic && hadPreviousQuestion) {
            return this.handleQuestionAnswer(userInput, signal, certaintyLevel, context);
        }
        
        // Also check semantic answer detection (for cases where mode wasn't set correctly)
        const isAnsweringQuestion = this.isAnsweringPreviousQuestion(userInput, context);
        if (isAnsweringQuestion && !introducesNewTopic) {
            return this.handleQuestionAnswer(userInput, signal, certaintyLevel, context);
        }
        
        switch (signal.type) {
            case 'emotional':
                // STATE MACHINE: Only ask question if NOT in CLARIFYING mode (not answering previous question)
                // If in CLARIFYING mode, this was already handled above
                if (this.conversationMode === MODES.CLARIFYING) {
                    // Should have been caught above, but fallback: treat as answer
                    return this.handleQuestionAnswer(userInput, signal, certaintyLevel, context);
                }
                
                // SINGLE MODE: CLARIFYING mode - message + question only, NO actions
                // PROPORTIONALITY: Emotional input gets reflection + one question, no actions
                // CERTAINTY: Match language to user's certainty level
                const emotionalQuestion = this.askOneClarifyingQuestion(userInput, certaintyLevel);
                const emotionalResponse = {
                    mode: MODES.CLARIFYING, // CLARIFYING mode: message + question, no actions
                    message: this.mirrorEmotion(userInput, certaintyLevel),
                    question: emotionalQuestion,
                    actions: [] // NO actions in CLARIFYING mode
                };
                // Track that we asked a question
                if (this.conversationContext.length > 0) {
                    const lastContext = this.conversationContext[this.conversationContext.length - 1];
                    if (lastContext) {
                        lastContext.hadQuestion = true;
                        lastContext.lastQuestion = emotionalQuestion;
                    }
                }
                return emotionalResponse;
                
            case 'explanatory':
                // ANTI-QUESTION-CHAINING: If we're already in CLARIFYING mode, user is answering
                // Don't ask another question - acknowledge and offer direction
                if (this.conversationMode === MODES.CLARIFYING) {
                    return this.handleQuestionAnswer(userInput, signal, certaintyLevel, context);
                }
                
                // PROPORTIONALITY: Explanatory input gets meaning reflection + narrowing question
                // COMMON SENSE: Don't escalate - user is explaining, not asking for solutions
                const explanatoryQuestion = this.narrowChoices(userInput, certaintyLevel);
                const explanatoryResponse = {
                    mode: MODES.CLARIFYING,
                    message: this.reflectMeaning(userInput, certaintyLevel),
                    question: explanatoryQuestion,
                    actions: []
                };
                // Track that we asked a question
                if (this.conversationContext.length > 0) {
                    const lastContext = this.conversationContext[this.conversationContext.length - 1];
                    if (lastContext) {
                        lastContext.hadQuestion = true;
                        lastContext.lastQuestion = explanatoryQuestion;
                    }
                }
                return explanatoryResponse;
                
            case 'overwhelmed':
                // DOBROWSKI: Check if this is loss of function (requires pause) or just intensity
                const hasLossOfFunction = signal.hasLossOfFunction === true;
                
                if (hasLossOfFunction) {
                    // Actual loss of function - offer pause
                    // SINGLE MODE: CALMING mode - reassurance + pause options only, NO questions, NO other actions
                    return {
                        mode: MODES.CALMING, // CALMING mode: message + pause actions only
                        message: this.gentleReassurance(),
                        question: null, // NO question in CALMING mode
                        actions: ['Pause', 'Come back later'] // Only pause options
                    };
                } else {
                    // Intensity without loss of function - treat as information, not escalation
                    // SINGLE MODE: CLARIFYING mode - message + question only, NO actions
                    const functionQuestion = this.askFunctionCheckQuestion();
                    const intensityResponse = {
                        mode: MODES.CLARIFYING, // CLARIFYING mode: message + question, no actions
                        message: this.handleIntensityAsInformation(userInput),
                        question: functionQuestion,
                        actions: [] // NO actions in CLARIFYING mode
                    };
                    // Track that we asked a question
                    if (this.conversationContext.length > 0) {
                        const lastContext = this.conversationContext[this.conversationContext.length - 1];
                        if (lastContext) {
                            lastContext.hadQuestion = true;
                            lastContext.lastQuestion = functionQuestion;
                        }
                    }
                    return intensityResponse;
                }
                
            case 'intense_emotion':
                // DOBROWSKI: Strong emotion but still functional - treat as information
                // SINGLE MODE: CLARIFYING mode - message + question only, NO actions
                const intenseQuestion = this.askFunctionCheckQuestion();
                const intenseResponse = {
                    mode: MODES.CLARIFYING, // CLARIFYING mode: message + question, no actions
                    message: this.handleIntensityAsInformation(userInput),
                    question: intenseQuestion,
                    actions: [] // NO actions in CLARIFYING mode
                };
                // Track that we asked a question
                if (this.conversationContext.length > 0) {
                    const lastContext = this.conversationContext[this.conversationContext.length - 1];
                    if (lastContext) {
                        lastContext.hadQuestion = true;
                        lastContext.lastQuestion = intenseQuestion;
                    }
                }
                return intenseResponse;
                
            case 'request_to_shrink':
                // SINGLE MODE: OFFERING_DIRECTION mode - message + direction options, NO questions
                // PROPORTIONALITY: User requested shrinking - offer transition, no escalation
                return {
                    mode: MODES.OFFERING_DIRECTION, // OFFERING_DIRECTION mode: message + actions, no questions
                    message: this.permissionBasedTransition(),
                    question: null, // NO question in OFFERING_DIRECTION mode
                    actions: ['Make this smaller']
                };
                
            case 'ready_for_action':
                // SINGLE MODE: STEPPING mode - steps/actions only, NO questions, NO reassurance
                // CONTEXT-SENSITIVE: Only show "Start this step" when user explicitly expresses readiness
                // OR when they selected a direction that implies action
                const hasExplicitReadiness = this.detectsExplicitReadiness(userInput);
                const selectedActionDirection = this.conversationContext.length > 0 && 
                                               this.conversationContext[this.conversationContext.length - 1]?.selectedDirection;
                const directionIsAction = selectedActionDirection && 
                                         this.directionImpliesAction(selectedActionDirection);
                
                // Show task-execution CTAs only if:
                // 1. User explicitly expressed readiness, OR
                // 2. User selected a direction that implies action, OR
                // 3. Direct assignment request (first interaction)
                const shouldShowActionButtons = hasExplicitReadiness || 
                                              directionIsAction ||
                                              (this.conversationContext.length === 1 && 
                                               signal.input && 
                                               this.isDirectAssignmentRequest(signal.input));
                
                return {
                    mode: MODES.STEPPING, // STEPPING mode: steps/actions only, no questions, no reassurance
                    message: this.presentNextTinyStep(context),
                    question: null, // NO question in STEPPING mode
                    actions: shouldShowActionButtons ? ['Start this step', 'Make it smaller'] : []
                };
                
            default:
                // Fallback to emotional with medium certainty
                return {
                    mode: MODES.LISTENING,
                    message: this.mirrorEmotion(userInput, 'medium'),
                    question: this.askOneClarifyingQuestion(userInput, 'medium'),
                    actions: []
                };
        }
    }
    
    // Helper functions for canonical response flow
    
    // Check if input is a direct assignment request (indicates readiness)
    // Uses config-driven patterns from FRANK_CONFIG.inputClassification.directRequestPatterns
    isDirectAssignmentRequest(input) {
        // Safety check for config
        if (typeof FRANK_CONFIG === 'undefined' || !FRANK_CONFIG.inputClassification || 
            !FRANK_CONFIG.inputClassification.directRequestPatterns) {
            // Fallback patterns
            const fallbackPatterns = [
                /help me (write|do|complete|finish)/i,
                /how do i/i,
                /how to/i,
                /show me/i,
                /break down/i,
                /steps/i,
                /guide/i
            ];
            return fallbackPatterns.some(pattern => pattern.test(input));
        }
        
        const patterns = FRANK_CONFIG.inputClassification.directRequestPatterns;
        return patterns.some(pattern => pattern.test(input));
    }
    
    // Mirror emotion using user's language
    // CERTAINTY MATCHING: Use tentative language for low certainty, direct for high
    // LANGUAGE CONSTRAINT: Prefer mirrors over interpretations, avoid absolute claims
    // DOBROWSKI: Normalize conflict, validate without glorifying
    mirrorEmotion(userInput, certaintyLevel = 'medium') {
        const lowerInput = userInput.toLowerCase();
        
        // Check for Dobrowski principles
        const dobrowskiConfig = (typeof FRANK_CONFIG !== 'undefined' && FRANK_CONFIG.reasoning && 
                                 FRANK_CONFIG.reasoning.dobrowskiPrinciples && 
                                 FRANK_CONFIG.reasoning.dobrowskiPrinciples.enabled) 
                                 ? FRANK_CONFIG.reasoning.dobrowskiPrinciples 
                                 : null;
        
        // High certainty: direct acknowledgment, no reframing
        // Low certainty: tentative language, hypotheses not conclusions
        const isLowCertainty = certaintyLevel === 'low';
        const isHighCertainty = certaintyLevel === 'high';
        
        // DOBROWSKI Principle 1: Normalize inner conflict
        if (lowerInput.includes("don't know why") || lowerInput.includes("dont know why") || 
            lowerInput.includes("bother") || lowerInput.includes("bothers me")) {
            if (dobrowskiConfig && dobrowskiConfig.normalizeConflict && dobrowskiConfig.normalizeConflict.enabled) {
                // BELIEF & AGENCY: Acknowledge the meaning without trying to fix or resolve it
                if (isLowCertainty) {
                    return "If it's bothering you this much, it probably matters to you.";
                }
                return "If it's bothering you this much, it probably matters to you.";
            }
        }
        
        // DOBROWSKI Principle 3: Validate growth pain without glorifying
        if (lowerInput.includes("worse") || lowerInput.includes("feeling worse") || 
            lowerInput.includes("used to") || lowerInput.includes("before")) {
            if (dobrowskiConfig && dobrowskiConfig.validateWithoutGlorifying && 
                dobrowskiConfig.validateWithoutGlorifying.enabled) {
                // BELIEF: Validate their experience without trying to fix it - trust their process
                return "Sometimes feeling worse happens when you're noticing more, not because you're failing.";
            }
        }
        
        // DOBROWSKI Principle 4: Meaning-making opt-in
        if (lowerInput.includes("point") || lowerInput.includes("purpose") || 
            lowerInput.includes("doesn't matter") || lowerInput.includes("doesnt matter")) {
            if (dobrowskiConfig && dobrowskiConfig.meaningMakingOptIn && 
                dobrowskiConfig.meaningMakingOptIn.enabled) {
                // BELIEF & AGENCY: Acknowledge the question without trying to resolve it
                return "That question makes sense.";
            }
        }
        
        if (lowerInput.includes("hate")) {
            // High certainty emotion - acknowledge directly, don't challenge
            if (isLowCertainty) {
                return "It sounds like this might feel really hard.";
            }
            return "That sounds really hard.";
        }
        
        if (lowerInput.includes("doesn't feel relevant") || lowerInput.includes("doesnt feel relevant")) {
            // Mirror user's language, avoid interpreting cause
            if (isLowCertainty) {
                return "If something feels like it might not be relevant, that can make it harder to care.";
            }
            return "If something feels pointless, it's way harder to care.";
        }
        
        if (lowerInput.includes("boring") || lowerInput.includes("pointless")) {
            // Simple reflection, no escalation
            if (isLowCertainty) {
                return "When something doesn't feel meaningful, it can be hard to engage with it.";
            }
            return "When something doesn't feel meaningful, it's hard to engage with it.";
        }
        
        if (lowerInput.includes("difficult") || lowerInput.includes("hard")) {
            // Proportional: mild difficulty gets mild response
            if (isLowCertainty) {
                return "This might feel like a lot right now.";
            }
            return "This feels like a lot right now.";
        }
        
        if (lowerInput.includes("overwhelmed") || lowerInput.includes("too much")) {
            // Only use if user explicitly says overwhelmed (proportionality rule)
            // But check if it's intensity vs loss of function first (handled in classifyInput)
            return "This looks like a lot.";
        }
        
        // Default mirror - match certainty level
        if (isLowCertainty) {
            return "I hear you.";
        }
        return "I hear you.";
    }
    
    // Ask one clarifying question based on input (metacognitive approach)
    // CERTAINTY MATCHING: Low certainty → ask before acting, offer hypotheses
    // COMMON SENSE: Don't introduce new problem framings user didn't imply
    askOneClarifyingQuestion(userInput, certaintyLevel = 'medium') {
        const lowerInput = userInput.toLowerCase();
        const isLowCertainty = certaintyLevel === 'low';
        
        if (lowerInput.includes('hate')) {
            // Metacognitive: Help identify what specifically is causing difficulty
            // High certainty emotion - direct question
            if (isLowCertainty) {
                return "What about it might feel the worst right now?";
            }
            return "What about it feels the worst right now?";
        }
        
        if (lowerInput.includes("doesn't feel relevant") || lowerInput.includes("doesnt feel relevant")) {
            // Metacognitive: Help understand their own learning needs (conditional knowledge)
            // COMMON SENSE: Don't turn this into stress management - stay with relevance issue
            if (isLowCertainty) {
                return "Could it be that it doesn't connect to your life, or maybe you don't see why you're being asked to do it?";
            }
            return "Is the problem more that it doesn't connect to your life, or you don't see why you're being asked to do it?";
        }
        
        if (lowerInput.includes('boring') || lowerInput.includes('pointless')) {
            // Metacognitive: Help identify what would make learning meaningful
            // Simple question, no escalation
            if (isLowCertainty) {
                return "What might be missing that would make it feel more meaningful?";
            }
            return "What's missing that would make it feel meaningful?";
        }
        
        if (lowerInput.includes('difficult') || lowerInput.includes('hard')) {
            // Metacognitive: Help identify specific cognitive challenges
            // Proportional: confusion gets clarification, not solutions
            if (isLowCertainty) {
                return "What part might feel the hardest?";
            }
            return "What part feels the hardest?";
        }
        
        if (lowerInput.includes('overwhelmed') || lowerInput.includes('too much')) {
            // Metacognitive: Help monitor their cognitive load
            // Only ask if user explicitly signals overwhelm (proportionality)
            return "What feels like too much?";
        }
        
        // Default clarifying question - match certainty level
        if (isLowCertainty) {
            return "What might be bothering you about this?";
        }
        return "What's bothering you about this?";
    }
    
    // Reflect meaning of explanatory input (metacognitive awareness)
    // CERTAINTY MATCHING: Match language to user's certainty
    // COMMON SENSE: Simple reflection, no escalation or new problem framings
    // LANGUAGE CONSTRAINT: Prefer mirrors over interpretations
    reflectMeaning(userInput, certaintyLevel = 'medium') {
        const lowerInput = userInput.toLowerCase();
        const isLowCertainty = certaintyLevel === 'low';
        
        if (lowerInput.includes("doesn't feel relevant") || lowerInput.includes("doesnt feel relevant")) {
            // Metacognitive: Acknowledge the impact on learning motivation
            // Mirror user's language, don't interpret cause
            if (isLowCertainty) {
                return "If something feels like it might not be relevant, that can make it harder to care.";
            }
            return "If something feels pointless, it's way harder to care.";
        }
        
        if (lowerInput.includes("doesn't connect") || lowerInput.includes("doesnt connect")) {
            // Metacognitive: Help understand why connection matters for learning
            // Simple reflection, no escalation
            if (isLowCertainty) {
                return "When something doesn't seem to connect to your life, it can be hard to see why it matters.";
            }
            return "When something doesn't connect to your life, it's hard to see why it matters.";
        }
        
        if (lowerInput.includes("because")) {
            // Metacognitive: Validate their self-awareness about their thinking
            // Acknowledge without adding interpretation
            return "I hear what you're saying.";
        }
        
        // Default reflection - match certainty level
        if (isLowCertainty) {
            return "That makes sense.";
        }
        return "That makes sense.";
    }
    
    // Narrow choices for explanatory input (metacognitive: help user understand their own learning needs)
    // CERTAINTY MATCHING: Low certainty → tentative questions, hypotheses
    // COMMON SENSE: Simplest plausible interpretation, don't introduce new framings
    // PROPORTIONALITY: Clarification only, no solutions or escalation
    narrowChoices(userInput, certaintyLevel = 'medium') {
        const lowerInput = userInput.toLowerCase();
        const isLowCertainty = certaintyLevel === 'low';
        
        if (lowerInput.includes("doesn't feel relevant") || lowerInput.includes("doesnt feel relevant") ||
            lowerInput.includes("doesn't connect") || lowerInput.includes("doesnt connect")) {
            // Metacognitive: Help user identify what they need for learning (conditional knowledge)
            // COMMON SENSE: Stay with relevance issue, don't turn into stress management
            if (isLowCertainty) {
                return "Could it be that it doesn't connect to your life, or maybe you don't see why you're being asked to do it?";
            }
            return "Is the problem more that it doesn't connect to your life, or you don't see why you're being asked to do it?";
        }
        
        if (lowerInput.includes("boring") || lowerInput.includes("pointless")) {
            // Metacognitive: Help user identify what would make learning meaningful
            // Simple question, no escalation
            if (isLowCertainty) {
                return "What might need to change for it to feel more engaging?";
            }
            return "What would need to change for it to feel more engaging?";
        }
        
        // Default narrowing question - match certainty level
        if (isLowCertainty) {
            return "Tell me more about that.";
        }
        return "Tell me more about that.";
    }
    
    // Gentle reassurance for overwhelmed state (only used when user explicitly signals overwhelm)
    // PROPORTIONALITY: Explicit overwhelm gets pause permission, nothing more
    // COMMON SENSE: Don't escalate - user said they're overwhelmed, respect that
    gentleReassurance() {
        // AGENCY: Communicate belief and agency, not permission or instruction
        // Never imply user needs to be calmed or fixed - just acknowledge their choice
        return "You can pause whenever you want.";
    }
    
    // DOBROWSKI: Handle intensity as information, not escalation
    // Treat strong reactions as heightened responsiveness, not fragility
    handleIntensityAsInformation(userInput) {
        const lowerInput = userInput.toLowerCase();
        
        // Check for Dobrowski config
        const dobrowskiConfig = (typeof FRANK_CONFIG !== 'undefined' && FRANK_CONFIG.reasoning && 
                                 FRANK_CONFIG.reasoning.dobrowskiPrinciples && 
                                 FRANK_CONFIG.reasoning.dobrowskiPrinciples.enabled) 
                                 ? FRANK_CONFIG.reasoning.dobrowskiPrinciples.intensityAsInformation 
                                 : null;
        
        if (lowerInput.includes('unbearable') || lowerInput.includes('too much') || 
            lowerInput.includes('overwhelming') || lowerInput.includes('intense')) {
            // DOBROWSKI: "When something feels unbearable, it's often because it's colliding with something important."
            return "When something feels unbearable, it's often because it's colliding with something important.";
        }
        
        if (lowerInput.includes('bother') || lowerInput.includes('bothers me')) {
            // DOBROWSKI Principle 1: Normalize conflict - "If it's bothering you this much, it probably matters to you."
            return "If it's bothering you this much, it probably matters to you.";
        }
        
        // Default: acknowledge intensity without pathologizing
        return "This feels really intense right now.";
    }
    
    // DOBROWSKI: Ask about function, not just emotion
    // "Are you still able to think, or do you want to slow things down?"
    askFunctionCheckQuestion() {
        return "Are you still able to think, or do you want to slow things down?";
    }
    
    // ANTI-QUESTION-CHAINING: Detect if user is answering a previous question
    // A response should be treated as an answer if:
    // 1. Previous Frank message contained a question
    // 2. User input is short or declarative (not exploratory)
    // 3. Semantically aligns with the topic of the question
    // 4. Reduces ambiguity rather than introducing new uncertainty
    isAnsweringPreviousQuestion(userInput, context) {
        // Must have previous context to check
        if (this.conversationContext.length === 0) {
            return false;
        }
        
        const lastContext = this.conversationContext[this.conversationContext.length - 1];
        
        // Check if previous response had a question
        if (!lastContext || !lastContext.hadQuestion) {
            return false;
        }
        
        const previousQuestion = lastContext.lastQuestion;
        if (!previousQuestion) {
            // Fallback: if in CLARIFYING mode, assume they're answering
            if (this.conversationMode === MODES.CLARIFYING && userInput.trim().length > 0) {
                return true;
            }
            return false;
        }
        
        // Analyze if input is an answer to the question
        return this.isSemanticAnswer(userInput, previousQuestion);
    }
    
    // Analyze if user input semantically answers the previous question
    isSemanticAnswer(userInput, previousQuestion) {
        const lowerInput = userInput.toLowerCase();
        const lowerQuestion = previousQuestion.toLowerCase();
        
        // Check 1: Is input short or declarative (not exploratory)?
        const isShortOrDeclarative = this.isShortOrDeclarative(userInput);
        if (!isShortOrDeclarative) {
            return false; // Too exploratory, probably not an answer
        }
        
        // Check 2: Does input semantically align with question topic?
        const semanticAlignment = this.checkSemanticAlignment(userInput, previousQuestion);
        if (!semanticAlignment) {
            return false; // Doesn't align with question topic
        }
        
        // Check 3: Does input reduce ambiguity rather than introduce new uncertainty?
        const reducesAmbiguity = this.reducesAmbiguity(userInput);
        if (!reducesAmbiguity) {
            return false; // Introduces new uncertainty, probably not an answer
        }
        
        return true;
    }
    
    // Check if input is short or declarative (not exploratory)
    isShortOrDeclarative(userInput) {
        const trimmed = userInput.trim();
        const wordCount = trimmed.split(/\s+/).length;
        
        // Short: 10 words or less
        if (wordCount <= 10) {
            return true;
        }
        
        // Declarative patterns (even if longer)
        const declarativePatterns = [
            /^(it|this|that|i|we|they) (is|feels|seems|doesn't|doesnt|can't|cannot)/i,
            /^(because|since|when|if)/i,
            /^(i don't|i dont|i can't|i cannot|i'm|im)/i,
            /^(seems|feels|looks|sounds)/i
        ];
        
        if (declarativePatterns.some(pattern => pattern.test(trimmed))) {
            return true;
        }
        
        // Exploratory patterns (not declarative)
        const exploratoryPatterns = [
            /\?$/, // Ends with question mark
            /^(what|why|how|when|where|who|which|can|could|should|would|might|maybe|perhaps)/i,
            /i (think|wonder|guess|suppose|feel like|feel as if)/i
        ];
        
        if (exploratoryPatterns.some(pattern => pattern.test(trimmed))) {
            return false; // Too exploratory
        }
        
        // Default: if not clearly exploratory, treat as potentially declarative
        return wordCount <= 15;
    }
    
    // Check if input semantically aligns with question topic
    checkSemanticAlignment(userInput, previousQuestion) {
        const lowerInput = userInput.toLowerCase();
        const lowerQuestion = previousQuestion.toLowerCase();
        
        // Extract key topics from question
        const questionTopics = this.extractQuestionTopics(previousQuestion);
        
        // Check if input addresses any of these topics
        for (const topic of questionTopics) {
            if (lowerInput.includes(topic)) {
                return true;
            }
        }
        
        // Check for semantic relationships
        // If question asks about "what feels worst", answers about feelings/problems align
        if (lowerQuestion.includes('worst') || lowerQuestion.includes('hardest') || 
            lowerQuestion.includes('bother') || lowerQuestion.includes('difficult')) {
            const answerIndicators = ['irrelevant', 'boring', 'pointless', 'hard', 'difficult', 
                                     'bad at', 'don\'t get', 'dont get', 'because', 'seems', 'feels'];
            if (answerIndicators.some(indicator => lowerInput.includes(indicator))) {
                return true;
            }
        }
        
        // If question asks about "why" or "what makes", answers with "because" or explanations align
        if (lowerQuestion.includes('why') || lowerQuestion.includes('what makes') || 
            lowerQuestion.includes('what about')) {
            if (lowerInput.includes('because') || lowerInput.includes('since') || 
                lowerInput.startsWith('it') || lowerInput.startsWith('this') || 
                lowerInput.startsWith('that')) {
                return true;
            }
        }
        
        // If question asks about relevance/connection, answers about relevance align
        if (lowerQuestion.includes('relevant') || lowerQuestion.includes('connect') || 
            lowerQuestion.includes('matter') || lowerQuestion.includes('point')) {
            if (lowerInput.includes('irrelevant') || lowerInput.includes('doesn\'t matter') || 
                lowerInput.includes('doesnt matter') || lowerInput.includes('pointless') ||
                lowerInput.includes('boring')) {
                return true;
            }
        }
        
        // Default: if in CLARIFYING mode and input is substantial, assume alignment
        if (this.conversationMode === MODES.CLARIFYING && userInput.trim().length > 3) {
            return true;
        }
        
        return false;
    }
    
    // Extract key topics from a question
    extractQuestionTopics(question) {
        const lowerQuestion = question.toLowerCase();
        const topics = [];
        
        // Extract nouns and key phrases
        const topicPatterns = [
            /(what|which|where|who) (about|is|are|does|do|makes|makes|feels|seems)/i,
            /(feels|seems|is|are) (the|most|really|very|so)/i,
            /(about|with|for) (it|this|that|the)/i
        ];
        
        // Common question topics
        if (lowerQuestion.includes('worst') || lowerQuestion.includes('hardest')) {
            topics.push('worst', 'hardest', 'difficult', 'problem', 'issue');
        }
        if (lowerQuestion.includes('relevant') || lowerQuestion.includes('matter')) {
            topics.push('relevant', 'matter', 'point', 'purpose', 'meaning');
        }
        if (lowerQuestion.includes('connect')) {
            topics.push('connect', 'relate', 'link', 'tie');
        }
        if (lowerQuestion.includes('bother') || lowerQuestion.includes('difficult')) {
            topics.push('bother', 'difficult', 'hard', 'problem', 'issue');
        }
        
        return topics;
    }
    
    // Check if input reduces ambiguity rather than introducing new uncertainty
    reducesAmbiguity(userInput) {
        const lowerInput = userInput.toLowerCase();
        
        // Uncertainty indicators (introduces new ambiguity)
        const uncertaintyIndicators = [
            'i don\'t know', 'i dont know', 'not sure', 'unsure', 'uncertain',
            'maybe', 'perhaps', 'might', 'could be', 'possibly',
            'i think', 'i guess', 'i suppose', 'i wonder',
            'what if', 'how about', 'why would', 'could it'
        ];
        
        // If input is mostly uncertainty, it doesn't reduce ambiguity
        const uncertaintyCount = uncertaintyIndicators.filter(indicator => 
            lowerInput.includes(indicator)).length;
        
        if (uncertaintyCount > 1) {
            return false; // Too much uncertainty
        }
        
        // Answer indicators (reduces ambiguity)
        const answerIndicators = [
            'because', 'since', 'when', 'it\'s', 'its', 'this is', 'that is',
            'seems', 'feels', 'is', 'are', 'doesn\'t', 'doesnt', 'can\'t', 'cannot',
            'irrelevant', 'boring', 'pointless', 'hard', 'difficult', 'bad at',
            'don\'t get', 'dont get'
        ];
        
        const answerCount = answerIndicators.filter(indicator => 
            lowerInput.includes(indicator)).length;
        
        // If has answer indicators and low uncertainty, reduces ambiguity
        if (answerCount > 0 && uncertaintyCount === 0) {
            return true;
        }
        
        // If has answer indicators and only one uncertainty word, still reduces ambiguity
        if (answerCount > 0 && uncertaintyCount <= 1) {
            return true;
        }
        
        // Short declarative statements reduce ambiguity
        if (userInput.trim().split(/\s+/).length <= 8 && uncertaintyCount === 0) {
            return true;
        }
        
        // Default: if not clearly uncertain, assume it reduces ambiguity
        return uncertaintyCount === 0;
    }
    
    // STATE MACHINE: Handle when user answers a question
    // After answer: mirror, acknowledge understanding, offer direction (no questions, no reframing, no regulation)
    handleQuestionAnswer(userInput, signal, certaintyLevel, context) {
        const lowerInput = userInput.toLowerCase();
        
        // 1. Mirror the user's answer using their language
        const mirror = this.mirrorAnswer(userInput, certaintyLevel);
        
        // 2. Briefly acknowledge understanding
        const understanding = this.acknowledgeUnderstanding(userInput, signal);
        
        // 3. Offer 2-3 directional options as buttons/statements (actions/paths, not inquiries)
        const directionChoices = this.offerDirectionalOptions(userInput, signal);
        
        // Internal understanding state: transition out of CLARIFYING, move toward action
        // Use SHRINKING or STEPPING as visible mode (UNDERSTANDING is internal guardrail)
        const nextMode = this.determineNextModeAfterAnswer(userInput, signal);
        
        // SINGLE MODE: OFFERING_DIRECTION mode - message + direction options, NO questions
        // Map nextMode to OFFERING_DIRECTION if it was SHRINKING (legacy)
        const visibleMode = (nextMode === MODES.SHRINKING || nextMode === 'shrinking') 
            ? MODES.OFFERING_DIRECTION 
            : nextMode;
        
        const response = {
            mode: visibleMode, // OFFERING_DIRECTION mode: message + actions, no questions
            message: mirror + (understanding ? " " + understanding : ""),
            question: null, // NO QUESTION - user already answered
            actions: directionChoices,
            _transitionCue: true // Flag to show transition cue from clarification to understanding
        };
        
        // Mark internal understanding state in context (not in response object)
        if (this.conversationContext.length > 0) {
            const lastContext = this.conversationContext[this.conversationContext.length - 1];
            if (lastContext) {
                lastContext._internalState = 'understanding'; // Internal guardrail flag
                lastContext._transitionedFromClarifying = true; // Flag for transition cue
            }
        }
        
        // Validate single mode enforcement
        this.validateSingleMode(response);
        
        return response;
    }
    
    // Detect if input introduces a new topic (vs answering previous question)
    introducesNewTopic(userInput, context) {
        // If no previous context, can't be a new topic
        if (this.conversationContext.length === 0) {
            return false;
        }
        
        const lowerInput = userInput.toLowerCase();
        
        // New topic indicators: completely different subject matter
        const newTopicIndicators = [
            // Assignment keywords (new assignment topic)
            /^(help me|i need|can you|show me|how do i|how to)/i,
            // Completely different subject
            /^(actually|wait|hold on|never mind|forget it|different)/i,
            // New question from user
            /\?$/,
            // Long exploratory input (probably new topic)
            userInput.trim().split(/\s+/).length > 20
        ];
        
        // Check if input matches new topic patterns
        if (newTopicIndicators.some(pattern => {
            if (typeof pattern === 'boolean') return pattern;
            return pattern.test(userInput);
        })) {
            return true;
        }
        
        // Check if input is asking a question (new topic, not answer)
        if (lowerInput.match(/^(what|why|how|when|where|who|which|can|could|should|would)/)) {
            return true;
        }
        
        return false;
    }
    
    // Mirror the user's answer using their language (not interpretation)
    mirrorAnswer(userInput, certaintyLevel) {
        const lowerInput = userInput.toLowerCase();
        const isLowCertainty = certaintyLevel === 'low';
        
        // Use user's exact language when possible
        if (lowerInput.includes("doesn't feel relevant") || lowerInput.includes("doesnt feel relevant") ||
            lowerInput.includes("irrelevant")) {
            if (isLowCertainty) {
                return "If it feels like it might not be relevant, that can make it harder to care.";
            }
            return "If it feels irrelevant, that makes it hard to care or try.";
        }
        
        if (lowerInput.includes("boring") || lowerInput.includes("pointless")) {
            return "When something doesn't feel meaningful, it's hard to engage with it.";
        }
        
        if (lowerInput.includes("difficult") || lowerInput.includes("hard")) {
            return "This feels like a lot right now.";
        }
        
        if (lowerInput.includes("don't get") || lowerInput.includes("dont get") || 
            lowerInput.includes("don't understand") || lowerInput.includes("dont understand")) {
            return "Not understanding why you need to do something makes it harder to care.";
        }
        
        if (lowerInput.includes("bad at") || lowerInput.includes("not good at")) {
            return "Feeling like you're not good at something makes it harder to start.";
        }
        
        // Default: reflect back using their language
        return "I hear you.";
    }
    
    // Briefly acknowledge understanding (not reframing, not regulation)
    acknowledgeUnderstanding(userInput, signal) {
        const lowerInput = userInput.toLowerCase();
        
        // Simple acknowledgment that we understand, no interpretation
        if (lowerInput.includes("irrelevant") || lowerInput.includes("pointless") || 
            lowerInput.includes("boring")) {
            return "We can go a few ways from here.";
        }
        
        if (lowerInput.includes("hard") || lowerInput.includes("difficult") || 
            lowerInput.includes("stuck")) {
            return "We can work with this.";
        }
        
        // Default: brief acknowledgment
        return null; // Keep it minimal
    }
    
    // Offer 2-3 directional options as buttons/statements (actions/paths, not inquiries)
    // CONTEXT-SENSITIVE: After explanations, offer reflective/orienting options
    // Only show task-execution CTAs ("Start this step") when user explicitly expresses readiness
    offerDirectionalOptions(userInput, signal) {
        const lowerInput = userInput.toLowerCase();
        const options = [];
        
        // Check if user explicitly signals overwhelm (for pause option)
        const hasExplicitOverwhelm = this.detectsOverwhelmSignal(userInput);
        
        // Check if this is an explanatory/reflective response (user provided explanation or reason)
        const isExplanatory = signal.type === 'explanatory' || 
                             lowerInput.includes("because") || 
                             lowerInput.includes("since") ||
                             lowerInput.includes("it's") || 
                             lowerInput.includes("its") ||
                             lowerInput.includes("feels like") ||
                             lowerInput.includes("seems like");
        
        // After explanatory input, offer reflective/orienting options (not task execution)
        if (isExplanatory) {
            options.push("That makes sense");
            options.push("Talk more about this");
            options.push("Help me get through the minimum");
            // Only add pause option if user explicitly signals overwhelm
            if (hasExplicitOverwhelm) {
                options.push("Pause for now");
            }
            return options;
        }
        
        // If user mentioned irrelevance/pointlessness, offer paths
        // GUARDRAIL: Do NOT include "Pause for now" for informational inputs unless user explicitly signals overwhelm
        if (lowerInput.includes("irrelevant") || lowerInput.includes("doesn't matter") || 
            lowerInput.includes("doesnt matter") || lowerInput.includes("pointless") ||
            lowerInput.includes("boring") || lowerInput.includes("don't care") ||
            lowerInput.includes("dont care")) {
            options.push("That makes sense");
            options.push("Talk more about this");
            options.push("Help me get through the minimum");
            // Only add pause option if user explicitly signals overwhelm
            if (hasExplicitOverwhelm) {
                options.push("Pause for now");
            }
            return options;
        }
        
        // If user mentioned difficulty/hard, offer paths
        // GUARDRAIL: Only include "Pause for now" if user explicitly signals overwhelm
        if (lowerInput.includes("hard") || lowerInput.includes("difficult") || 
            lowerInput.includes("stuck")) {
            options.push("That makes sense");
            options.push("Talk more about this");
            options.push("Make this smaller");
            // Only add pause option if user explicitly signals overwhelm
            if (hasExplicitOverwhelm || lowerInput.includes("overwhelmed")) {
                options.push("Pause for now");
            }
            return options;
        }
        
        // If user mentioned not understanding/getting it
        // GUARDRAIL: Only include "Pause for now" if user explicitly signals overwhelm
        if (lowerInput.includes("don't get") || lowerInput.includes("dont get") || 
            lowerInput.includes("don't understand") || lowerInput.includes("dont understand")) {
            options.push("That makes sense");
            options.push("Talk more about this");
            options.push("Break this down differently");
            // Only add pause option if user explicitly signals overwhelm
            if (hasExplicitOverwhelm) {
                options.push("Pause for now");
            }
            return options;
        }
        
        // Default directional options (reflective/orienting, not task execution)
        // GUARDRAIL: Only include "Pause for now" if user explicitly signals overwhelm
        options.push("That makes sense");
        options.push("Talk more about this");
        options.push("Help me get through the minimum");
        // Only add pause option if user explicitly signals overwhelm
        if (hasExplicitOverwhelm) {
            options.push("Pause for now");
        }
        return options;
    }
    
    // Detect if user explicitly expresses readiness for action
    // Only show "Start this step" when readiness is explicitly expressed
    detectsExplicitReadiness(userInput) {
        if (!userInput) return false;
        const lowerInput = userInput.toLowerCase();
        
        // Explicit readiness indicators
        const readinessSignals = [
            'i\'m ready', 'im ready', 'ready', 'let\'s start', 'lets start', 'let\'s go', 'lets go',
            'show me', 'help me start', 'i want to start', 'can we start', 'how do i start',
            'what\'s the first step', 'whats the first step', 'first step', 'begin', 'start now',
            'i want to do this', 'let\'s do this', 'lets do this', 'i\'m ready to start', 'im ready to start'
        ];
        
        return readinessSignals.some(signal => lowerInput.includes(signal));
    }
    
    // Check if a selected direction implies action (should show "Start this step")
    directionImpliesAction(directionText) {
        if (!directionText) return false;
        const lowerText = directionText.toLowerCase();
        
        // Action-implying directions
        const actionDirections = [
            'help me get through', 'help me start', 'show me', 'let\'s start', 'lets start',
            'make this smaller', 'break this down', 'start this', 'begin', 'get started'
        ];
        
        return actionDirections.some(direction => lowerText.includes(direction));
    }
    
    // Determine next visible mode after answer (UNDERSTANDING is internal, not visible)
    // SINGLE MODE: After answer, use OFFERING_DIRECTION or STEPPING (never mix)
    determineNextModeAfterAnswer(userInput, signal) {
        const lowerInput = userInput.toLowerCase();
        
        // If user is ready for action, go to STEPPING
        if (signal.type === 'ready_for_action' || 
            lowerInput.includes("help") || lowerInput.includes("show me") || 
            lowerInput.includes("how do") || lowerInput.includes("start")) {
            return MODES.STEPPING;
        }
        
        // Default: OFFERING_DIRECTION (offers direction without being too action-oriented)
        return MODES.OFFERING_DIRECTION;
    }
    
    // Check if there's unresolved ambiguity (only then ask another question)
    hasUnresolvedAmbiguity(userInput, signal) {
        const lowerInput = userInput.toLowerCase();
        
        // If input is very vague or uncertain, there's ambiguity
        const vagueIndicators = [
            'i don\'t know', 'i dont know', 'not sure', 'unsure', 'uncertain',
            'maybe', 'perhaps', 'might', 'could be', 'possibly',
            'i think', 'i guess', 'i suppose', 'i wonder'
        ];
        
        const vagueCount = vagueIndicators.filter(indicator => lowerInput.includes(indicator)).length;
        if (vagueCount > 1) {
            return true; // Too vague, needs clarification
        }
        
        // If input is very short and doesn't provide context, there's ambiguity
        if (userInput.trim().split(/\s+/).length <= 3 && vagueCount > 0) {
            return true;
        }
        
        // If input introduces new uncertainty (not resolving previous question)
        if (lowerInput.includes('but') || lowerInput.includes('however') || 
            lowerInput.includes('although') || lowerInput.includes('except')) {
            // Might be introducing new complexity
            return true;
        }
        
        // Default: if input is declarative and specific, ambiguity is resolved
        return false;
    }
    
    // Validate that response follows single mode rule
    // Each mode has specific allowed elements:
    // - LISTENING: message only (no question, no actions)
    // - CLARIFYING: message + question only (no actions)
    // - OFFERING_DIRECTION: message + actions only (no question)
    // - CALMING: message + pause actions only (no question, no other actions)
    // - STEPPING: steps/actions only (no question, no reassurance)
    validateSingleMode(response) {
        if (!response || !response.mode) {
            return; // Can't validate without mode
        }
        
        const mode = response.mode;
        
        // LISTENING mode: message only, no question, no actions
        if (mode === MODES.LISTENING) {
            if (response.question) {
                console.warn('LISTENING mode should not have question - moving to CLARIFYING');
                response.mode = MODES.CLARIFYING;
            }
            if (response.actions && response.actions.length > 0) {
                console.warn('LISTENING mode should not have actions - removing');
                response.actions = [];
            }
        }
        
        // CLARIFYING mode: message + question only, no actions
        if (mode === MODES.CLARIFYING) {
            if (response.actions && response.actions.length > 0) {
                console.warn('CLARIFYING mode should not have actions - removing');
                response.actions = [];
            }
        }
        
        // OFFERING_DIRECTION mode: message + actions only, no question
        if (mode === MODES.OFFERING_DIRECTION || mode === MODES.SHRINKING) {
            if (response.question) {
                console.warn('OFFERING_DIRECTION mode should not have question - removing');
                response.question = null;
            }
        }
        
        // CALMING mode: message + pause actions only, no question
        if (mode === MODES.CALMING || mode === MODES.PAUSED) {
            if (response.question) {
                console.warn('CALMING mode should not have question - removing');
                response.question = null;
            }
            // Only allow pause-related actions
            if (response.actions && response.actions.length > 0) {
                const pauseActions = response.actions.filter(action => 
                    action.toLowerCase().includes('pause') || 
                    action.toLowerCase().includes('come back') ||
                    action.toLowerCase().includes('later'));
                if (pauseActions.length !== response.actions.length) {
                    console.warn('CALMING mode should only have pause actions - filtering');
                    response.actions = pauseActions;
                }
            }
        }
        
        // STEPPING mode: steps/actions only, no question, no reassurance
        if (mode === MODES.STEPPING) {
            if (response.question) {
                console.warn('STEPPING mode should not have question - removing');
                response.question = null;
            }
        }
    }
    
    // DEPRECATED: These functions replaced by mirrorAnswer, acknowledgeUnderstanding, offerDirectionalOptions
    // Keeping for backward compatibility but should not be used
    acknowledgeAnswer(userInput, certaintyLevel) {
        return this.mirrorAnswer(userInput, certaintyLevel);
    }
    
    demonstrateUnderstanding(userInput, signal) {
        return this.acknowledgeUnderstanding(userInput, signal);
    }
    
    offerDirectionChoices(userInput, signal) {
        return this.offerDirectionalOptions(userInput, signal);
    }
    
    // Agency-based transition to shrinking
    // BELIEF & AGENCY: Offer options without prescribing - user chooses their path
    permissionBasedTransition() {
        return "Want to keep going, or make this into one tiny step?";
    }
    
    // Present next tiny step for action mode
    presentNextTinyStep(context) {
        // Get the first step from resilience steps or assignment steps
        if (context && context.breakdown && context.breakdown.steps && context.breakdown.steps.length > 0) {
            const firstStep = context.breakdown.steps[0];
            return {
                title: firstStep.title,
                description: firstStep.description,
                needsInput: firstStep.needsInput || false,
                inputPrompt: firstStep.inputPrompt || null,
                inputPlaceholder: firstStep.inputPlaceholder || null
            };
        }
        
        // If no breakdown yet, generate one
        if (this.currentAssignment) {
            const breakdown = this.breakDownAssignment(this.currentAssignment);
            if (breakdown.steps && breakdown.steps.length > 0) {
                const firstStep = breakdown.steps[0];
                return {
                    title: firstStep.title,
                    description: firstStep.description,
                    needsInput: firstStep.needsInput || false,
                    inputPrompt: firstStep.inputPrompt || null,
                    inputPlaceholder: firstStep.inputPlaceholder || null
                };
            }
        }
        
        // Default tiny step
        return {
            title: "One Tiny Thing",
            description: "What's the smallest, easiest part you could do right now? Just one thing.",
            needsInput: true,
            inputPrompt: "What's one tiny thing you could do?",
            inputPlaceholder: "Type one small thing..."
        };
    }
    
    // Generate contextual buttons based on mode and last user input
    generateContextualButtons(mode, lastInput) {
        if (!lastInput) return [];
        
        const lowerInput = lastInput.toLowerCase();
        const buttons = [];
        
        // SINGLE MODE: Each mode has specific button rules
        if (mode === MODES.LISTENING || mode === 'listening') {
            // LISTENING mode: no action buttons
            return [];
        }
        
        if (mode === MODES.CLARIFYING || mode === 'clarifying') {
            // CLARIFYING mode: no action buttons (only question)
            return [];
        }
        
        if (mode === MODES.OFFERING_DIRECTION || mode === MODES.SHRINKING || mode === 'shrinking' || mode === 'offering_direction') {
            // OFFERING_DIRECTION mode: direction buttons only
            buttons.push({
                text: 'Want to keep going',
                action: 'continue'
            });
            buttons.push({
                text: 'Make this into one tiny step',
                action: 'shrink'
            });
        }
        
        if (mode === MODES.STEPPING || mode === 'stepping') {
            // Contextual buttons based on what user said
            if (lowerInput.includes('how') || lowerInput.includes('explain')) {
                buttons.push({
                    text: 'Make this smaller',
                    action: 'make-smaller'
                });
            } else if (lowerInput.includes('stuck') || lowerInput.includes('can\'t')) {
                buttons.push({
                    text: 'Want to keep talking?',
                    action: 'talk-more'
                });
                buttons.push({
                    text: 'Help me explain this to my teacher',
                    action: 'explain-to-teacher'
                });
            } else if (lowerInput.includes('pause') || lowerInput.includes('later')) {
                buttons.push({
                    text: 'Pause',
                    action: 'pause'
                });
                buttons.push({
                    text: 'Come back later',
                    action: 'pause'
                });
            }
        }
        
        return buttons;
    }
    
    // Create paraphrase mirror using user's own language
    // CERTAINTY MATCHING: Match language to user's certainty level
    // LANGUAGE CONSTRAINT: Prefer mirrors over interpretations, avoid absolute claims
    createParaphraseMirror(userInput) {
        // Extract key phrases from user input and reflect them back
        // This replaces generic acknowledgements like "Thanks" or "Here's a good place to start"
        const lowerInput = userInput.toLowerCase();
        const certaintyLevel = this.detectCertaintyLevel(userInput);
        const isLowCertainty = certaintyLevel === 'low';
        
        // Look for specific phrases to mirror
        if (lowerInput.includes("doesn't feel relevant") || lowerInput.includes("doesnt feel relevant")) {
            if (isLowCertainty) {
                return "If something feels like it might not be relevant, that can make it harder to care.";
            }
            return "If something feels pointless, it's way harder to care.";
        }
        
        if (lowerInput.includes("hate")) {
            // High certainty emotion - acknowledge directly
            if (isLowCertainty) {
                return "It sounds like this might feel really hard.";
            }
            return "That sounds really hard.";
        }
        
        if (lowerInput.includes("boring") || lowerInput.includes("pointless")) {
            if (isLowCertainty) {
                return "When something doesn't feel meaningful, it can be hard to engage with it.";
            }
            return "When something doesn't feel meaningful, it's hard to engage with it.";
        }
        
        if (lowerInput.includes("difficult") || lowerInput.includes("hard")) {
            if (isLowCertainty) {
                return "This might feel like a lot right now.";
            }
            return "This feels like a lot right now.";
        }
        
        // Default: use a simple reflection
        return "I hear you.";
    }

    checkPermissionCard() {
        // Check if user has dismissed the permission card before
        const dismissed = localStorage.getItem('permissionCardDismissed');
        if (dismissed === 'true') {
            document.getElementById('permissionCard').classList.add('hidden');
        }
    }

    dismissPermissionCard() {
        const card = document.getElementById('permissionCard');
        card.classList.add('hidden');
        localStorage.setItem('permissionCardDismissed', 'true');
    }

    init() {
        const submitBtn = document.getElementById('submitBtn');
        const pauseBtn = document.getElementById('pauseBtn');
        const assignmentInput = document.getElementById('assignmentInput');

        if (!submitBtn) {
            console.error('submitBtn not found!');
            return;
        }
        
        if (!assignmentInput) {
            console.error('assignmentInput not found!');
            return;
        }

        console.log('Attaching event listeners...');
        submitBtn.addEventListener('click', (e) => {
            console.log('Button clicked!');
            e.preventDefault();
            this.processAssignment();
        });
        assignmentInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && e.ctrlKey) {
                this.processAssignment();
            }
        });
        assignmentInput.addEventListener('focus', () => {
            document.querySelector('.input-section').classList.add('input-focused');
        });
        assignmentInput.addEventListener('blur', () => {
            document.querySelector('.input-section').classList.remove('input-focused');
        });
        pauseBtn.addEventListener('click', () => this.pauseAndSave());
        
        // ESC key to close modal
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.closeModal();
            }
        });
        
        this.renderSavedAssignments();
    }

    closeModal() {
        const modal = document.getElementById('responseModal');
        modal.classList.add('hidden');
        document.body.style.overflow = '';
        
        // Always restore the main input section when closing modal
        const mainInputSection = document.querySelector('.main-input-section');
        if (mainInputSection) {
            mainInputSection.style.display = '';
        }
        
        // Clear the input field and reset button text
        const assignmentInput = document.getElementById('assignmentInput');
        const submitBtn = document.getElementById('submitBtn');
        if (assignmentInput) {
            assignmentInput.value = '';
            assignmentInput.placeholder = 'Messy is fine, add your assignment or random thoughts here';
        }
        if (submitBtn) {
            submitBtn.textContent = 'Help me get started';
        }
        
        // Reset conversation state
        this.conversationState = null;
        this.currentAssignment = null;
        this.lastUserInput = null;
    }

    openModal() {
        const modal = document.getElementById('responseModal');
        modal.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
    }

    processAssignment() {
        console.log('processAssignment called');
        const input = document.getElementById('assignmentInput').value.trim();
        console.log('Input:', input);
        
        // Check if we're in a conversation flow (answering a question)
        if (this.conversationState && this.conversationState.waitingForAnswer) {
            if (!input) {
                alert('Please share your thoughts before clicking Share.');
                return;
            }
            // Check for inappropriate content in answers too
            if (this.checkInappropriateContent(input)) {
                return;
            }
            // Use canonical response flow for answers too
            this.handleAnswerWithCanonicalFlow(input);
            return;
        }
        
        if (!input) {
            alert('Please enter an assignment or question!');
            return;
        }

        // Check for inappropriate content
        if (this.checkInappropriateContent(input)) {
            return;
        }

        try {
            this.currentAssignment = input;
            
            // Use canonical response flow: classify, then respond once in one mode
            console.log('Building context...');
            let context;
            try {
                context = this.buildContext(input);
                console.log('Context built:', context);
            } catch (error) {
                console.error('Error in buildContext:', error);
                throw new Error('Failed to build context: ' + error.message);
            }
            
            console.log('Generating response...');
            let response;
            try {
                response = this.generateFrankResponse(input, context);
                console.log('Response generated:', response);
            } catch (error) {
                console.error('Error in generateFrankResponse:', error);
                throw new Error('Failed to generate response: ' + error.message);
            }
            
            // Validate response structure
            if (!response || !response.mode) {
                console.error('Invalid response structure:', response);
                throw new Error('Invalid response structure - missing mode');
            }
            
            // Validate single mode enforcement before displaying
            this.validateSingleMode(response);
            
            // Set mode from response
            this.setConversationMode(response.mode);
            
            // ANTI-QUESTION-CHAINING: Track if we asked a question in this response
            if (response.question) {
                // Find the last context entry and mark it as having a question
                if (this.conversationContext.length > 0) {
                    const lastContext = this.conversationContext[this.conversationContext.length - 1];
                    if (lastContext) {
                        lastContext.hadQuestion = true;
                        lastContext.lastQuestion = response.question; // Store the actual question
                    }
                }
            }
            
            // Display the response based on mode
            console.log('Displaying response...');
            try {
                this.displayCanonicalResponse(response, input);
                console.log('Response displayed successfully');
            } catch (error) {
                console.error('Error in displayCanonicalResponse:', error);
                throw new Error('Failed to display response: ' + error.message);
            }
        } catch (error) {
            console.error('Error processing assignment:', error);
            console.error('Error stack:', error.stack);
            // Show more helpful error message with full details
            const errorMsg = error.message || 'Unknown error';
            alert(`Error: ${errorMsg}\n\nStack: ${error.stack ? error.stack.substring(0, 200) : 'No stack trace'}\n\nPlease check the browser console (F12) for full details.`);
        }
    }
    
    // Build context for response generation
    buildContext(input) {
        const breakdown = this.breakDownAssignment(input);
        return {
            breakdown: breakdown,
            conversationHistory: this.conversationContext,
            currentMode: this.conversationMode
        };
    }
    
    // Display response from canonical flow
    displayCanonicalResponse(response, originalInput) {
        console.log('displayCanonicalResponse called with:', response);
        
        if (!response) {
            console.error('No response provided to displayCanonicalResponse');
            throw new Error('No response provided');
        }
        
        const responseContent = document.getElementById('responseContent');
        const responseHeader = document.getElementById('responseHeader');
        
        if (!responseContent) {
            console.error('responseContent element not found');
            throw new Error('Could not find response container element');
        }
        
        // Open modal
        try {
            this.openModal();
        } catch (error) {
            console.error('Error opening modal:', error);
            throw error;
        }
        
        // Hide/show sections based on mode
        // SINGLE MODE: Each mode has specific UI requirements
        const visibleMode = response.mode;
        if (visibleMode === MODES.LISTENING || visibleMode === MODES.CLARIFYING || 
            visibleMode === MODES.CALMING || visibleMode === MODES.OFFERING_DIRECTION ||
            visibleMode === MODES.PAUSED || visibleMode === MODES.SHRINKING) {
            this.hideMiddleSections();
            if (responseHeader) {
                responseHeader.style.display = 'none';
            }
        } else if (visibleMode === MODES.STEPPING) {
            // STEPPING mode: show middle sections for step display
            this.showMiddleSections();
            if (responseHeader) {
                responseHeader.style.display = '';
            }
        } else {
            // Fallback
            this.showMiddleSections();
            if (responseHeader) {
                responseHeader.style.display = '';
            }
        }
        
        // Build HTML based on response structure
        let html = '';
        
        // Add transition cue if moving from clarification to understanding
        if (response._transitionCue || 
            (this.conversationContext.length > 0 && 
             this.conversationContext[this.conversationContext.length - 1]?._transitionedFromClarifying)) {
            html += `
                <div class="transition-cue">
                    <span class="transition-indicator">→</span>
                    <span class="transition-text">Got it. Here are some ways we can move forward:</span>
                </div>
            `;
        }
        
        // Add message
        if (response.message) {
            if (typeof response.message === 'string') {
                html += `<div class="persona-message">${response.message}</div>`;
            } else if (typeof response.message === 'object' && response.message.title) {
                // If message is an object (like from presentNextTinyStep), render as step
                html += this.renderStepFromMessage(response.message);
            } else {
                // Fallback: render as string
                html += `<div class="persona-message">${JSON.stringify(response.message)}</div>`;
            }
        }
        
        // Add question if present
        if (response.question) {
            html += `
                <div class="conversation-flow">
                    <div class="conversation-question">
                        <p class="question-text">${response.question}</p>
                    </div>
                </div>
            `;
        }
        
        // Add actions if present
        if (response.actions && response.actions.length > 0) {
            html += '<div class="contextual-buttons">';
            response.actions.forEach(actionText => {
                const action = this.mapActionToHandler(actionText);
                html += `<button class="contextual-btn" data-action="${action}">${actionText}</button>`;
            });
            html += '</div>';
        }
        
        responseContent.innerHTML = html;
        
        // Set up input area if in listening/clarifying mode
        if (response.mode === MODES.LISTENING || response.mode === MODES.CLARIFYING) {
            try {
                this.setupQuestionInput(response.mode);
            } catch (error) {
                console.error('Error setting up question input:', error);
                // Don't throw - just log, the response is already displayed
            }
        }
        
        // Set up action button handlers
        const actionButtons = responseContent.querySelectorAll('.contextual-btn');
        actionButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                this.handleCanonicalAction(btn.dataset.action, originalInput);
            });
        });
        
        // Set up step input handlers if step is rendered
        if (typeof response.message === 'object' && response.message.title) {
            const stepInput = responseContent.querySelector('.advice-step-input');
            const stepButton = responseContent.querySelector('.advice-start-btn');
            
            if (stepInput && stepButton) {
                stepButton.addEventListener('click', () => {
                    const answer = stepInput.value.trim();
                    if (answer || !response.message.needsInput) {
                        this.handleStepCompletion(answer, response.message);
                    } else {
                        alert('Please share your thoughts before clicking Start this step.');
                    }
                });
                
                stepInput.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' && e.ctrlKey) {
                        const answer = stepInput.value.trim();
                        if (answer || !response.message.needsInput) {
                            stepButton.click();
                        }
                    }
                });
                
                setTimeout(() => {
                    if (response.message.needsInput) {
                        stepInput.focus();
                    }
                }, 100);
            }
        }
        
        // Hide main input section during conversation
        const mainInputSection = document.querySelector('.main-input-section');
        if (mainInputSection && (response.mode === MODES.LISTENING || response.mode === MODES.CLARIFYING)) {
            mainInputSection.style.display = 'none';
        }
    }
    
    // Handle step completion
    handleStepCompletion(answer, stepMessage) {
        // Store answer if needed
        if (!this.conversationState) {
            this.conversationState = {
                originalInput: this.currentAssignment,
                answers: [],
                waitingForAnswer: false
            };
        }
        
        if (answer) {
            this.conversationState.answers.push({
                step: stepMessage.title,
                answer: answer
            });
        }
        
        // Mark step as complete
        const responseContent = document.getElementById('responseContent');
        const currentStep = responseContent.querySelector('.advice-card.step-current');
        if (currentStep) {
            currentStep.classList.remove('step-current');
            currentStep.classList.add('step-complete');
            
            // Show quiet acknowledgment
            const celebration = document.createElement('div');
            celebration.className = 'step-celebration';
            celebration.textContent = 'One step done.';
            currentStep.appendChild(celebration);
            
            setTimeout(() => {
                celebration.remove();
            }, 2000);
        }
        
        // Ask if they want to continue
        setTimeout(() => {
            this.askWantToKeepGoingAfterStep();
        }, 2000);
    }
    
    // Ask if user wants to keep going after completing a step
    askWantToKeepGoingAfterStep() {
        const responseContent = document.getElementById('responseContent');
        const nudgeDiv = document.createElement('div');
        nudgeDiv.className = 'keep-going-nudge';
        nudgeDiv.innerHTML = `
            <p class="nudge-question">Want to keep going?</p>
            <div class="nudge-options">
                <button class="nudge-btn nudge-yes">Yes</button>
                <button class="nudge-btn nudge-not-now">Not right now</button>
            </div>
        `;
        
        responseContent.appendChild(nudgeDiv);
        
        nudgeDiv.querySelector('.nudge-yes').addEventListener('click', () => {
            nudgeDiv.remove();
            // Continue to next step
            this.continueToNextStep();
        });
        
        nudgeDiv.querySelector('.nudge-not-now').addEventListener('click', () => {
            // Permission-based statement instead of generic "That's okay"
            nudgeDiv.innerHTML = `
                <p class="nudge-response">You can come back whenever you're ready.</p>
            `;
            setTimeout(() => {
                this.pauseAndSave();
                this.closeModal();
            }, 2000);
        });
    }
    
    // Continue to next step
    continueToNextStep() {
        // Get next step from breakdown
        if (this.currentAssignment) {
            const breakdown = this.breakDownAssignment(this.currentAssignment);
            const completedSteps = this.conversationState?.answers?.length || 0;
            
            if (breakdown.steps && breakdown.steps.length > completedSteps) {
                const nextStep = breakdown.steps[completedSteps];
                const context = this.buildContext(this.currentAssignment);
                // User has indicated readiness by completing previous step
                const response = {
                    mode: MODES.STEPPING,
                    message: {
                        title: nextStep.title,
                        description: nextStep.description,
                        needsInput: nextStep.needsInput || false,
                        inputPrompt: nextStep.inputPrompt || null,
                        inputPlaceholder: nextStep.inputPlaceholder || null
                    },
                    question: null,
                    actions: ['Start this step', 'Make it smaller']
                };
                
                this.setConversationMode(response.mode);
                this.displayCanonicalResponse(response, this.currentAssignment);
            }
        }
    }
    
    // Render step from message object
    renderStepFromMessage(stepMessage) {
        let html = `
            <div class="resilience-advice">
                <div class="advice-card step-current" data-step-index="0">
                    <h4 class="advice-title">${stepMessage.title}</h4>
                    <p class="advice-text">${stepMessage.description}</p>
        `;
        
        if (stepMessage.needsInput) {
            html += `
                    <div class="advice-input-area">
                        <p class="advice-input-prompt">${stepMessage.inputPrompt || 'Share your thoughts:'}</p>
                        <textarea 
                            class="advice-step-input"
                            placeholder="${stepMessage.inputPlaceholder || 'Type your answer here...'}"
                            rows="3"
                        ></textarea>
                        <button class="advice-start-btn primary-btn">Start this step</button>
                    </div>
            `;
        }
        
        html += `
                </div>
            </div>
        `;
        return html;
    }
    
    // Map action text to handler name
    mapActionToHandler(actionText) {
        const mapping = {
            'Pause': 'pause',
            'Come back later': 'pause',
            'Make this smaller': 'make-smaller',
            'Start this step': 'start-step',
            'Make it smaller': 'make-smaller'
        };
        return mapping[actionText] || actionText.toLowerCase().replace(/\s+/g, '-');
    }
    
    // Handle actions from canonical response
    // Handle actions from canonical response
    // CONTEXT-SENSITIVE: Track selected direction to determine if action buttons should be shown
    // GUARDRAIL: When user selects "pause" or "this is too much" option, allow calming language
    handleCanonicalAction(action, originalInput) {
        // Get the action text from the button that was clicked
        const actionButtons = document.querySelectorAll('.contextual-btn');
        let selectedDirection = null;
        actionButtons.forEach(btn => {
            if (btn.dataset.action === action) {
                selectedDirection = btn.textContent;
            }
        });
        
        // Store selected direction in context for readiness detection
        if (selectedDirection && this.conversationContext.length > 0) {
            const lastContext = this.conversationContext[this.conversationContext.length - 1];
            if (lastContext) {
                lastContext.selectedDirection = selectedDirection;
            }
        }
        
        switch(action) {
            case 'pause':
                // User explicitly selected pause option - this is an explicit overwhelm signal
                // Mark this in context so calming language can be shown
                if (this.conversationContext.length > 0) {
                    const lastContext = this.conversationContext[this.conversationContext.length - 1];
                    if (lastContext) {
                        lastContext.userSelectedPause = true; // Flag for calming language guardrail
                    }
                }
                this.pauseAndSave();
                break;
            case 'make-smaller':
                // Generate new response with shrink request
                const shrinkResponse = this.generateFrankResponse('make it smaller', this.buildContext(originalInput));
                this.setConversationMode(shrinkResponse.mode);
                this.displayCanonicalResponse(shrinkResponse, originalInput);
                break;
            case 'start-step':
                // Continue to next step
                this.advanceToNextStepInFlow();
                break;
            case 'that-makes-sense':
            case 'talk-more-about-this':
            case 'help-me-get-through-the-minimum':
                // User selected a reflective/orienting option - generate response based on selection
                // These don't immediately show "Start this step" - they continue the conversation
                const directionResponse = this.generateFrankResponse(selectedDirection || action, this.buildContext(originalInput));
                this.setConversationMode(directionResponse.mode);
                this.displayCanonicalResponse(directionResponse, originalInput);
                break;
            default:
                console.log('Unknown action:', action);
        }
    }
    
    // Setup question input for listening/clarifying modes
    setupQuestionInput(mode) {
        const responseContent = document.getElementById('responseContent');
        const questionContainer = responseContent.querySelector('.conversation-question');
        
        if (questionContainer) {
            const inputArea = document.createElement('div');
            inputArea.className = 'question-input-area';
            inputArea.innerHTML = `
                <textarea 
                    id="questionAnswerInput" 
                    class="question-answer-input"
                    placeholder="Type your answer here..."
                    rows="3"
                ></textarea>
                <button id="questionSubmitBtn" class="question-submit-btn">Respond</button>
            `;
            questionContainer.appendChild(inputArea);
            
            const questionInput = document.getElementById('questionAnswerInput');
            const questionSubmitBtn = document.getElementById('questionSubmitBtn');
            
            questionSubmitBtn.addEventListener('click', () => {
                const answer = questionInput.value.trim();
                if (answer) {
                    this.handleAnswerWithCanonicalFlow(answer);
                } else {
                    alert('Please share your thoughts before clicking Respond.');
                }
            });
            
            questionInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && e.ctrlKey) {
                    const answer = questionInput.value.trim();
                    if (answer) {
                        this.handleAnswerWithCanonicalFlow(answer);
                    }
                }
            });
            
            setTimeout(() => questionInput.focus(), 100);
        }
    }
    
    // Handle answer using canonical flow
    handleAnswerWithCanonicalFlow(answer) {
        if (!answer || answer.trim() === '') {
            return;
        }
        
        // Check for inappropriate content
        if (this.checkInappropriateContent(answer)) {
            return;
        }
        
        // Store answer in conversation state
        if (!this.conversationState) {
            this.conversationState = {
                originalInput: this.currentAssignment,
                answers: [],
                waitingForAnswer: false
            };
        }
        this.conversationState.answers.push(answer);
        
        // Show user's answer
        const responseContent = document.getElementById('responseContent');
        const currentQuestion = responseContent.querySelector('.conversation-question');
        if (currentQuestion) {
            const inputArea = currentQuestion.querySelector('.question-input-area');
            if (inputArea) {
                inputArea.remove();
            }
            
            const answerDiv = document.createElement('div');
            answerDiv.className = 'user-answer';
            answerDiv.innerHTML = `<p><strong>You:</strong> ${answer}</p>`;
            currentQuestion.appendChild(answerDiv);
        }
        
        // Generate response using canonical flow
        const context = this.buildContext(this.currentAssignment || answer);
        const response = this.generateFrankResponse(answer, context);
        
        // Set mode from response
        this.setConversationMode(response.mode);
        
        // Display the response
        setTimeout(() => {
            this.displayCanonicalResponse(response, this.currentAssignment || answer);
        }, 500);
    }
    
    // Advance to next step in flow
    advanceToNextStepInFlow() {
        // This will be called when user clicks "Start this step"
        // Implementation depends on step structure
        const responseContent = document.getElementById('responseContent');
        const currentStep = responseContent.querySelector('.advice-card.step-current');
        
        if (currentStep) {
            // Mark as complete and show next step
            currentStep.classList.remove('step-current');
            currentStep.classList.add('step-complete');
            
            // Show next step if available
            // This would need to be integrated with the step structure
        }
    }

    checkInappropriateContent(input) {
        // Check if content filtering is enabled
        if (typeof FRANK_CONFIG === 'undefined' || !FRANK_CONFIG || !FRANK_CONFIG.rules || !FRANK_CONFIG.rules.filterInappropriateContent || !FRANK_CONFIG.rules.filterInappropriateContent.enabled) {
            return false;
        }

        const lowerInput = input.toLowerCase();
        const categories = FRANK_CONFIG.rules.filterInappropriateContent.categories;
        
        // Check each category
        for (const category in categories) {
            const keywords = categories[category];
            for (const keyword of keywords) {
                if (lowerInput.includes(keyword)) {
                    // Inappropriate content detected
                    this.showInappropriateContentResponse();
                    return true;
                }
            }
        }
        
        return false;
    }

    showInappropriateContentResponse() {
        const responseHeader = document.getElementById('responseHeader');
        const responseContent = document.getElementById('responseContent');
        
        // Hide header and middle sections
        if (responseHeader) {
            responseHeader.style.display = 'none';
        }
        this.hideMiddleSections();
        
        // Open modal instead of showing inline
        this.openModal();
        
        // Get the response message from config
        const responseMessage = (FRANK_CONFIG && FRANK_CONFIG.rules && FRANK_CONFIG.rules.filterInappropriateContent && FRANK_CONFIG.rules.filterInappropriateContent.response) 
            ? FRANK_CONFIG.rules.filterInappropriateContent.response.message 
            : "I'm smart but not all knowing - some things are better left to asking a trusted adult.";
        
        // Display the response
        responseContent.innerHTML = `
            <div class="persona-message" style="border-left-color: var(--accent-orange);">
                <p style="font-size: 1.1rem; line-height: 1.8;">${responseMessage}</p>
            </div>
        `;
        
        // Clear input
        const inputField = document.getElementById('assignmentInput');
        inputField.value = '';
        inputField.focus();
        
        // Reset button
        const submitBtn = document.getElementById('submitBtn');
        submitBtn.textContent = 'Help me get started';
    }

    breakDownAssignment(assignment) {
        const lowerAssignment = assignment.toLowerCase();
        
        // Detect if this is general help/emotional support vs an assignment
        const generalHelpKeywords = ['hate', 'difficult', 'hard', 'struggling', 'stuck', 'overwhelmed', 
            'frustrated', 'anxious', 'stress', 'can\'t', 'cannot', 'don\'t know', 'help me', 
            'feel', 'feeling', 'deal with', 'cope', 'handle', 'situation', 'problem', 'issue',
            'doesn\'t', 'doesnt', 'seem', 'relevant', 'boring', 'pointless', 'useless', 'sucks',
            'not working', 'not helpful', 'waste of time'];
        
        // More specific assignment keywords - removed 'class' and 'read' as they're too generic
        const assignmentKeywords = ['assignment', 'essay', 'paper', 'write a', 'write an', 'read the', 'read a', 'read an', 'book report', 
            'compare', 'contrast', 'analyze', 'research paper', 'research project', 'homework assignment', 'due date'];
        
        const hasGeneralHelp = generalHelpKeywords.some(keyword => lowerAssignment.includes(keyword));
        const hasAssignment = assignmentKeywords.some(keyword => lowerAssignment.includes(keyword));
        
        // If it has general help keywords, prioritize resilience help
        // Only treat as assignment if it has clear assignment language AND no emotional struggle words
        if (hasGeneralHelp) {
            return this.generateBreakdown(assignment, 'resilience_help');
        }
        
        // Detect assignment type
        let assignmentType = 'general';
        if (lowerAssignment.includes('compare') || lowerAssignment.includes('contrast') || 
            lowerAssignment.includes('correlate') || lowerAssignment.includes('theme')) {
            assignmentType = 'compare_contrast';
        } else if (lowerAssignment.includes('write') && lowerAssignment.includes('paper')) {
            assignmentType = 'essay';
        } else if (lowerAssignment.includes('read') || lowerAssignment.includes('book')) {
            assignmentType = 'reading_response';
        }

        return this.generateBreakdown(assignment, assignmentType);
    }

    generateBreakdown(assignment, type) {
        const personaMessage = this.getPersonaMessage(assignment, type);
        const howToStart = this.getHowToStart(assignment, type);
        
        // For resilience help, check if regulation should be included
        let steps;
        if (type === 'resilience_help') {
            const includeRegulation = this.detectsOverwhelmSignal(assignment);
            steps = this.getSteps(assignment, type, includeRegulation);
        } else {
            steps = this.getSteps(assignment, type);
        }

        return {
            type,
            personaMessage,
            howToStart,
            steps
        };
    }

    getPersonaMessage(assignment, type) {
        // Feature Set 6: Use approved emotional acknowledgment language from config
        // Safety check for FRANK_CONFIG
        let resilienceMessages;
        if (typeof FRANK_CONFIG === 'undefined' || !FRANK_CONFIG.personality || !FRANK_CONFIG.personality.emotionalAcknowledgment) {
            console.warn('FRANK_CONFIG not available, using fallback messages');
            resilienceMessages = [
                "This kind of assignment can feel heavy.",
                "A lot of people get stuck here.",
                "You're not behind.",
                "This looks like a lot."
            ];
        } else {
            resilienceMessages = FRANK_CONFIG.personality.emotionalAcknowledgment.canSay;
        }
        
        const messages = {
            resilience_help: resilienceMessages[Math.floor(Math.random() * resilienceMessages.length)],
            compare_contrast: `Hey there! 👋 I see you're tackling a compare/contrast assignment. Think of it like this: imagine you're explaining to a friend why two movies are similar but different - you wouldn't just say "they're both good," right? You'd break down WHY. That's exactly what we're going to do here, but with themes and ideas instead of movies!`,
            essay: `Hey! 📝 So you've got a paper to write. I know it can feel like staring at a blank page is like trying to climb Mount Everest in flip-flops - overwhelming! But here's the thing: every big paper is just a bunch of smaller ideas connected together. We're going to build this one step at a time, like putting together a LEGO set.`,
            reading_response: `Hello! 📚 Reading assignments can feel like you're being asked to understand a whole universe in one go. But here's a secret: even the most complex books are made of smaller pieces. We're going to break this down like you're explaining the plot to a friend who missed the movie - piece by piece, in a way that makes sense.`,
            general: `Hi there! 🎯 I see you've got a task ahead of you. You know that feeling when you look at a big project and your brain goes "NOPE, TOO MUCH"? We're going to trick your brain by making it think we're only doing tiny, easy things. One small step at a time, and before you know it, you'll be done!`
        };

        return messages[type] || messages.general;
    }

    getHowToStart(assignment, type) {
        if (type === 'resilience_help') {
            // Permission-based statement, no generic "That's okay", no multi-directional guidance
            return {
                title: "Let's Start Here",
                content: `You're dealing with something difficult right now.`
            };
        } else if (type === 'compare_contrast') {
            // Metacognitive: Planning phase - help user set goals and select strategies
            return {
                title: "How to Get Started",
                content: `Before you start, take a moment to think: What's your goal here? Start by identifying ONE theme from the book that really stood out to you. Then, think about where you've seen something similar in the news, social media, or your own life. That connection is your starting point - everything else builds from there.`
            };
        } else if (type === 'essay') {
            // Metacognitive: Planning - break down the cognitive task
            return {
                title: "How to Get Started",
                content: `Don't try to write the whole paper in your head first! Start by just writing down three things you want to say - they don't have to be perfect, they don't even have to be in order. Just get your thoughts on paper. Once you see them written down, your brain will start connecting the dots.`
            };
        } else {
            // Metacognitive: Planning - identify the easiest cognitive task first
            return {
                title: "How to Get Started",
                content: `Before diving in, think: What's the smallest, simplest thing you can do right now? Start with that. It gets your brain moving and helps you see what comes next.`
            };
        }
    }

    getSteps(assignment, type, includeRegulation = false) {
        if (type === 'resilience_help') {
            // GUARDRAIL: Only include regulation if user explicitly signals overwhelm OR selected pause
            const hasExplicitOverwhelm = this.detectsOverwhelmSignal(this.lastUserInput || '');
            const userSelectedPause = this.conversationContext.length > 0 && 
                                     this.conversationContext[this.conversationContext.length - 1]?.userSelectedPause;
            return this.getResilienceSteps(assignment, includeRegulation && (hasExplicitOverwhelm || userSelectedPause));
        } else if (type === 'compare_contrast') {
            return this.getCompareContrastSteps(assignment);
        } else if (type === 'essay') {
            return this.getEssaySteps(assignment);
        } else {
            return this.getGeneralSteps(assignment);
        }
    }

    getResilienceSteps(assignment, includeRegulation = false) {
        const steps = [];
        
        // Only include "Take a Breath" if user explicitly signals overwhelm
        if (includeRegulation) {
            steps.push({
                title: "Take a Breath",
                description: "If you want, you can pause here. You can pause whenever you want.",
                needsInput: false
            });
        }
        
        steps.push(
            {
                title: "Name What's Happening",
                description: "What's going on for you right now? Being aware of what you're thinking and feeling is the first step to understanding how to work with it.",
                needsInput: true,
                inputPrompt: "What's on your mind?",
                inputPlaceholder: "Share what's happening - whatever comes to mind..."
            },
            {
                title: "What Can You Control?",
                description: "What can you actually control here? What can't you control? Understanding what's in your control helps you focus your energy where it actually matters.",
                needsInput: true,
                inputPrompt: "What's in your control vs. what's not?",
                inputPlaceholder: "List what you can control and what you can't..."
            },
            {
                title: "One Small Action",
                description: "What's one tiny thing you could do right now? Think about what action would actually help in this situation - not what you 'should' do, but what would actually work.",
                needsInput: true,
                inputPrompt: "What's one small action you could take?",
                inputPlaceholder: "Type one small thing you could do..."
            },
            {
                title: "Be Kind to Yourself",
                description: "What would you tell a friend in this situation?",
                needsInput: true,
                inputPrompt: "What would you say to a friend?",
                inputPlaceholder: "Type what you'd tell a friend..."
            },
            {
                title: "Remember It's Temporary",
                description: "This feeling won't last forever. You've gotten through hard things before. Think about what helped you get through difficult times in the past - that's information about what strategies work for you.",
                needsInput: false
            }
        );
        
        return steps;
    }

    getCompareContrastSteps(assignment) {
        const lowerAssignment = assignment.toLowerCase();
        const hasBook = lowerAssignment.includes('malala') || lowerAssignment.includes('book');
        
        return [
            {
                title: "Identify the Themes (Like Finding the Main Characters)",
                description: "Think of themes as the 'main characters' of the book's message. What big ideas kept showing up? For example, if you read about someone fighting for education, that's a theme. Write down 2-3 themes that really stuck with you - don't overthink it, just what felt important. As you work, notice: Are you understanding the themes, or just guessing? If you're not sure, that's information - it tells you what to focus on.",
                checklist: [
                    "List 2-3 main themes from the book",
                    "For each theme, write one sentence about why it matters",
                    "Pick the theme that interests you most",
                    "Check: Do you actually understand this theme, or are you guessing? (This helps you know what to focus on)"
                ],
                analogy: "It's like picking your favorite song from an album - you don't need to analyze every song, just the ones that hit you."
            },
            {
                title: "Find Current Connections (The 'Wait, This Sounds Familiar' Step)",
                description: "Now, where have you seen something similar happening? This doesn't have to be a perfect match - think about the CORE idea. If the book talks about fighting for rights, where do you see people fighting for rights today? News articles, social movements, even school policies can work! While you're looking, pay attention: Are you finding real connections, or forcing them? If connections feel forced, that's a signal to look for a different angle or a different current event.",
                checklist: [
                    "Brainstorm 3-5 current events or situations that relate to your chosen theme",
                    "For each one, write one sentence about the connection",
                    "Choose 2-3 that have the strongest connections",
                    "Ask yourself: Do these connections feel real, or am I forcing them? (If forced, try a different angle)"
                ],
                analogy: "Like when you hear a new song and think 'this reminds me of that other song' - you're finding the musical connection. Same idea, but with themes!"
            },
            {
                title: "Create Your Comparison Framework (The Organizing Step)",
                description: "This is where you decide HOW you'll compare. Will you talk about similarities first, then differences? Or will you go theme by theme? Create a simple structure: 'I'll compare X from the book to Y happening now, focusing on how they're similar in [way] but different in [way].' Think about which structure makes more sense for your specific comparison - there's no one right way, just what works for your ideas.",
                checklist: [
                    "Decide on your comparison structure (similarities vs differences, or theme-by-theme)",
                    "Write a simple sentence: 'I'm comparing [theme] to [current event]'",
                    "List 2-3 specific points of comparison",
                    "Ask: Does this structure make sense for what I'm comparing? (If not, try the other approach)"
                ],
                analogy: "It's like planning a road trip - you need to know your starting point, destination, and a few stops along the way. You don't need the whole map, just the main route."
            },
            {
                title: "Gather Your Evidence (The Detective Work)",
                description: "Now find specific examples. From the book: what scene or quote shows your theme? From current events: what specific example shows the connection? You don't need a million examples - just 2-3 solid ones that really prove your point.",
                checklist: [
                    "Find 2-3 specific examples from the book (scenes, quotes, or moments)",
                    "Find 2-3 specific examples from current events (news articles, events, or situations)",
                    "For each example, write one sentence explaining why it matters"
                ],
                analogy: "Like building a case - you don't need every piece of evidence, just the strongest ones that really prove your point."
            },
            {
                title: "Write Your First Draft (The 'Just Get It Down' Step)",
                description: "Don't worry about perfection! Just write. Start with: 'In [book], one important theme is [theme]. This connects to [current event] because...' Write your thoughts, even if they're messy. You can clean it up later - right now, just get the ideas out of your head and onto paper.",
                checklist: [
                    "Write an introduction that states your main comparison",
                    "Write one paragraph about the theme in the book",
                    "Write one paragraph about the current connection",
                    "Write one paragraph comparing them",
                    "Write a conclusion that ties it together"
                ],
                analogy: "Like making a sandwich - you put all the ingredients together first, then you can adjust and make it look nice. But first, you need the ingredients!"
            },
            {
                title: "Revise and Polish (The 'Make It Shine' Step)",
                description: "Now that you have your ideas down, make them clearer. Read through and ask: 'Does this make sense? Can someone else understand my point?' Add transitions between paragraphs, fix any confusing parts, and make sure your examples really support your main idea. After revising, ask yourself: Did this strategy work? What would I do differently next time? This helps you learn what works for you.",
                checklist: [
                    "Read through your draft once for clarity",
                    "Add transition sentences between paragraphs",
                    "Check that each paragraph has a clear point",
                    "Fix any spelling or grammar mistakes",
                    "Read it one more time out loud to catch awkward phrases",
                    "Reflect: What worked well in this process? What would I change next time?"
                ],
                analogy: "Like editing a photo - the picture is already there, you're just making the colors pop and cropping out the blurry parts."
            }
        ];
    }

    getEssaySteps(assignment) {
        return [
            {
                title: "Understand What You're Being Asked",
                description: "Read the assignment carefully and identify the key question or prompt. What is the main thing you need to answer or explain? Before you start, check: Do you actually understand what's being asked, or are you guessing? If you're not sure, that's valuable information - it tells you what to clarify first.",
                checklist: [
                    "Highlight the main question in the assignment",
                    "Identify any key words (analyze, explain, argue, etc.)",
                    "Write in your own words what you think you need to do",
                    "Check: Do I actually understand this, or am I guessing? (If guessing, ask for clarification)"
                ]
            },
            {
                title: "Brainstorm Your Ideas",
                description: "Don't worry about organization yet - just get your thoughts down. What do you know about this topic? What do you think? As you brainstorm, notice: Are ideas coming easily, or are you stuck? If stuck, that's information - it might mean you need to learn more about the topic first, or approach it from a different angle.",
                checklist: [
                    "Write down everything you know about the topic",
                    "List any questions you have",
                    "Note any ideas that pop into your head",
                    "Notice: Are ideas flowing, or am I stuck? (If stuck, try a different approach)"
                ]
            },
            {
                title: "Create an Outline",
                description: "Organize your ideas into a simple structure: introduction, main points, conclusion. This is your plan - think about what order makes the most sense for your ideas. Does this structure work for what you want to say? If it feels forced, try a different organization.",
                checklist: [
                    "Write your main argument or thesis",
                    "List 3-5 main points you want to make",
                    "Decide the order that makes the most sense",
                    "Check: Does this structure work, or does it feel forced? (If forced, try reorganizing)"
                ]
            },
            {
                title: "Write Your First Draft",
                description: "Start writing! Don't worry about perfection - just get your ideas down on paper. As you write, pay attention: Is this flowing, or are you getting stuck? If you're stuck, that's a signal - maybe you need to go back and clarify your ideas, or try writing in a different order.",
                checklist: [
                    "Write the introduction",
                    "Write each body paragraph",
                    "Write the conclusion",
                    "Notice while writing: Is this flowing, or am I stuck? (If stuck, try a different approach)"
                ]
            },
            {
                title: "Revise and Edit",
                description: "Read through your work and make it better. Check for clarity, flow, and correctness. After revising, think: What worked well in my process? What would I do differently next time? This reflection helps you become a better writer.",
                checklist: [
                    "Read through once for content",
                    "Check for clear transitions",
                    "Fix grammar and spelling",
                    "Make sure everything makes sense",
                    "Reflect: What worked well? What would I change next time?"
                ]
            }
        ];
    }

    getGeneralSteps(assignment) {
        return [
            {
                title: "Break It Into Smaller Pieces",
                description: "Look at your assignment and identify the main components. What are the different parts you need to complete? Before you start, think: What's your plan here? Breaking things down helps you see what you're actually dealing with, which makes it less overwhelming.",
                checklist: [
                    "List all the parts of the assignment",
                    "Put them in order of what needs to be done first",
                    "Identify which parts seem easiest",
                    "Ask: Does this breakdown make sense? (If not, try a different way of organizing)"
                ]
            },
            {
                title: "Start With the Easiest Part",
                description: "Begin with whatever feels most manageable. Getting started is often the hardest part! As you work, notice: Is this strategy working? Are you making progress, or are you still stuck? If stuck, that's information - maybe you need a different starting point.",
                checklist: [
                    "Pick the easiest or most interesting part",
                    "Set a timer for 15-20 minutes",
                    "Work on just that one part",
                    "Check: Is this working, or am I still stuck? (If stuck, try a different part)"
                ]
            },
            {
                title: "Tackle the Rest One at a Time",
                description: "Work through each part systematically. Don't try to do everything at once. While you work, monitor your progress: Are you understanding what you're doing, or just going through the motions? If you're not understanding, that's a signal to slow down or ask for help.",
                checklist: [
                    "Move to the next part",
                    "Complete it before moving on",
                    "Take short breaks between parts",
                    "Monitor: Am I understanding this, or just going through motions? (If not understanding, slow down)"
                ]
            },
            {
                title: "Review and Complete",
                description: "Check your work and make sure everything is done and makes sense. After you're done, take a moment to reflect: What worked well in your process? What would you do differently next time? This helps you learn what strategies work for you.",
                checklist: [
                    "Review each part",
                    "Make sure nothing is missing",
                    "Double-check requirements",
                    "Reflect: What worked well? What would I change next time?"
                ]
            }
        ];
    }

    hideMiddleSections() {
        const bottomSections = document.querySelector('.bottom-sections-wrapper');
        if (bottomSections) {
            bottomSections.style.display = 'none';
        }
    }

    showMiddleSections() {
        const bottomSections = document.querySelector('.bottom-sections-wrapper');
        if (bottomSections) {
            bottomSections.style.display = '';
        }
    }

    startConversationFlow(input) {
        this.conversationState = {
            originalInput: input,
            currentQuestionIndex: 0,
            answers: [],
            waitingForAnswer: true
        };

        const questions = this.getProbingQuestions(input);
        this.conversationState.questions = questions;
        
        this.displayConversationStart(input);
    }

    getFirstQuestion(input) {
        // Use paraphrase mirror instead of generic acknowledgment
        const inputType = this.detectInputType(input);
        
        if (inputType === 'emotional') {
            // For emotional input, use reflection + one clarifying question
            const mirror = this.createParaphraseMirror(input);
            
            // Generate contextual question based on input
            const lowerInput = input.toLowerCase();
            let question;
            
            if (lowerInput.includes('hate')) {
                question = "What about it feels the worst right now?";
            } else if (lowerInput.includes("doesn't feel relevant") || lowerInput.includes("doesnt feel relevant")) {
                question = "Is the problem more that it doesn't connect to your life, or you don't see why you're being asked to do it?";
            } else if (lowerInput.includes('boring') || lowerInput.includes('pointless')) {
                question = "What's missing that would make it feel meaningful?";
            } else if (lowerInput.includes('difficult') || lowerInput.includes('hard')) {
                question = "What part feels the hardest?";
            } else {
                question = "What's bothering you about this?";
            }
            
            return {
                acknowledgment: mirror,
                question: question
            };
        } else {
            // For action-oriented input
            return {
                acknowledgment: "This looks like a lot.",
                question: "What's the assignment about?"
            };
        }
    }

    getProbingQuestions(input) {
        // Generate contextual questions based on what they actually said
        // Questions should reference their specific situation
        const lowerInput = input.toLowerCase();
        
        // Build questions that reference their specific concerns
        let questions = [];
        
        // First question: dig into what they mentioned
        if (lowerInput.includes('relevant') || lowerInput.includes('doesn\'t seem') || lowerInput.includes('doesnt seem')) {
            questions.push("You mentioned it doesn't feel relevant. What makes it feel that way?");
        } else if (lowerInput.includes('hate') || lowerInput.includes('don\'t like') || lowerInput.includes('dont like')) {
            questions.push("You said you hate it. What specifically is making you feel that way?");
        } else if (lowerInput.includes('boring') || lowerInput.includes('pointless') || lowerInput.includes('useless')) {
            questions.push("You mentioned it feels boring/pointless. What's missing that would make it feel meaningful?");
        } else if (lowerInput.includes('difficult') || lowerInput.includes('hard') || lowerInput.includes('struggling')) {
            questions.push("You said it's difficult. What part feels the hardest?");
        } else if (lowerInput.includes('overwhelmed') || lowerInput.includes('too much')) {
            questions.push("You mentioned feeling overwhelmed. What feels like too much?");
        } else {
            // Generic first question that acknowledges what they said
            questions.push("Tell me more about what's bothering you about this.");
        }
        
        // We'll generate the remaining questions dynamically based on their answers
        // Just return the first question for now
        return questions;
    }

    getContextualQuestion(originalInput, answers, questionIndex) {
        // Generate questions that build on their previous answers
        const lowerInput = originalInput.toLowerCase();
        const allText = (originalInput + ' ' + answers.join(' ')).toLowerCase();
        
        // Second question: explore based on what they've shared
        if (questionIndex === 1) {
            // Reference their first answer if we have it
            if (answers.length > 0) {
                const firstAnswer = answers[0].toLowerCase();
                if (firstAnswer.includes('relevant') || firstAnswer.includes('doesn\'t matter') || firstAnswer.includes('pointless')) {
                    return "When you think about it not being relevant, what would make it feel more connected to your life?";
                } else if (firstAnswer.includes('boring') || firstAnswer.includes('dull')) {
                    return "What would need to change for it to feel more engaging?";
                } else if (firstAnswer.includes('hard') || firstAnswer.includes('difficult') || firstAnswer.includes('confusing')) {
                    return "What part feels the most confusing or overwhelming?";
                } else if (firstAnswer.includes('time') || firstAnswer.includes('waste')) {
                    return "How is this affecting your time or energy?";
                }
            }
            
            // Fallback based on original input
            if (lowerInput.includes('class') || lowerInput.includes('school')) {
                return "How is this class affecting your day-to-day?";
            } else {
                return "How is this showing up in your life right now?";
            }
        }
        
        // Third question: explore what they need or what's possible
        if (questionIndex === 2) {
            // Reference their previous answers
            if (answers.length > 0) {
                const combinedAnswers = answers.join(' ').toLowerCase();
                if (combinedAnswers.includes('can\'t') || combinedAnswers.includes('cannot') || combinedAnswers.includes('impossible')) {
                    return "What would need to be different for this to feel manageable?";
                } else if (combinedAnswers.includes('stuck') || combinedAnswers.includes('trapped')) {
                    return "What would help you feel less stuck?";
                } else if (combinedAnswers.includes('tired') || combinedAnswers.includes('exhausted') || combinedAnswers.includes('drained')) {
                    return "What would help you feel more energized about this?";
                }
            }
            
            return "What do you wish was different about this situation?";
        }
        
        // Fallback (shouldn't reach here)
        return "Tell me more about what's on your mind.";
    }

    displayConversationStart(input) {
        const responseHeader = document.getElementById('responseHeader');
        const responseContent = document.getElementById('responseContent');
        
        // Open modal instead of showing inline
        this.openModal();
        
        // Hide the header for resilience help (conversation flow)
        if (responseHeader) {
            responseHeader.style.display = 'none';
        }
        
        // Also hide pause button for resilience help
        const pauseBtn = document.getElementById('pauseBtn');
        if (pauseBtn && FRANK_CONFIG && FRANK_CONFIG.display && FRANK_CONFIG.display.pauseButtonOnlyForAssignments) {
            pauseBtn.style.display = 'none';
        }

        // Get first question with paraphrase mirror (no generic acknowledgements)
        const firstQuestion = this.getFirstQuestion(input);
        
        // Mode-based rendering: listening/clarifying modes show NO action buttons
        const mode = this.conversationMode || 'listening';
        const showButtons = mode !== 'listening' && mode !== 'clarifying';
        
        let html = `
            <div class="persona-message">${firstQuestion.acknowledgment}</div>
            <div class="conversation-flow">
                <div class="conversation-question">
                    <p class="question-text">${firstQuestion.question}</p>
                </div>
            </div>
        `;
        
        // Only add buttons if not in listening/clarifying mode
        if (showButtons) {
            const buttons = this.generateContextualButtons(mode, input);
            if (buttons.length > 0) {
                html += '<div class="contextual-buttons">';
                buttons.forEach(btn => {
                    html += `<button class="contextual-btn" data-action="${btn.action}">${btn.text}</button>`;
                });
                html += '</div>';
            }
        }

        responseContent.innerHTML = html;
        
        // Add input area directly below the question for better UX
        const questionContainer = responseContent.querySelector('.conversation-question');
        if (questionContainer) {
            const inputArea = document.createElement('div');
            inputArea.className = 'question-input-area';
            inputArea.innerHTML = `
                <textarea 
                    id="questionAnswerInput" 
                    class="question-answer-input"
                    placeholder="Type your answer here..."
                    rows="3"
                ></textarea>
                <button id="questionSubmitBtn" class="question-submit-btn">Respond</button>
            `;
            questionContainer.appendChild(inputArea);
            
            // Set up the question-specific input handler
            const questionInput = document.getElementById('questionAnswerInput');
            const questionSubmitBtn = document.getElementById('questionSubmitBtn');
            
            questionSubmitBtn.addEventListener('click', () => {
                const answer = questionInput.value.trim();
                if (answer) {
                    this.handleAnswer(answer);
                } else {
                    alert('Please share your thoughts before clicking Respond.');
                }
            });
            
            questionInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && e.ctrlKey) {
                    const answer = questionInput.value.trim();
                    if (answer) {
                        this.handleAnswer(answer);
                    }
                }
            });
            
            // Focus the question input
            setTimeout(() => {
                questionInput.focus();
            }, 100);
        }
        
        // Set up contextual button handlers if any
        const contextualBtns = responseContent.querySelectorAll('.contextual-btn');
        contextualBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                this.handleContextualButton(btn.dataset.action);
            });
        });
        
        // Hide the main input section for cleaner UX during conversation
        const mainInputSection = document.querySelector('.main-input-section');
        if (mainInputSection) {
            mainInputSection.style.display = 'none';
        }
    }
    
    handleContextualButton(action) {
        // Handle contextual button actions
        switch(action) {
            case 'continue':
                this.setConversationMode('stepping');
                this.revealFirstStepOnly();
                break;
            case 'shrink':
                this.setConversationMode('shrinking');
                // Generate one tiny step
                this.generateTinyStep();
                break;
            case 'make-smaller':
                // Break down current step further
                const currentStepDiv = document.querySelector('.advice-card.step-current');
                if (currentStepDiv) {
                    const stepTitle = currentStepDiv.querySelector('.advice-title')?.textContent || '';
                    const step = { title: stepTitle };
                    this.handleStepFeedback('make-smaller', currentStepDiv, step);
                }
                break;
            case 'talk-more':
                this.setConversationMode('clarifying');
                this.askClarifyingQuestion();
                break;
            case 'pause':
                this.pauseAndSave();
                break;
        }
    }
    
    generateTinyStep() {
        // Generate one tiny, minimal step
        const responseContent = document.getElementById('responseContent');
        const tinyStepDiv = document.createElement('div');
        tinyStepDiv.className = 'advice-card step-current';
        tinyStepDiv.innerHTML = `
            <h4 class="advice-title">One Tiny Thing</h4>
            <p class="advice-text">What's the smallest, easiest part you could do right now? Just one thing.</p>
            <div class="advice-input-area">
                <textarea 
                    class="advice-step-input"
                    placeholder="What's one tiny thing you could do?"
                    rows="2"
                ></textarea>
                <button class="advice-start-btn primary-btn">Start this step</button>
            </div>
        `;
        
        responseContent.appendChild(tinyStepDiv);
        
        const inputField = tinyStepDiv.querySelector('.advice-step-input');
        const startBtn = tinyStepDiv.querySelector('.advice-start-btn');
        
        startBtn.addEventListener('click', () => {
            const answer = inputField.value.trim();
            if (answer) {
                this.setConversationMode('stepping');
                this.revealFirstStepOnly();
            }
        });
        
        setTimeout(() => inputField.focus(), 100);
    }
    
    askClarifyingQuestion() {
        // Ask a clarifying question based on context
        const responseContent = document.getElementById('responseContent');
        const lastInput = this.lastUserInput || '';
        
        let question;
        const lowerInput = lastInput.toLowerCase();
        
        if (lowerInput.includes('explain') || lowerInput.includes('how')) {
            question = "What part feels confusing?";
        } else if (lowerInput.includes('stuck') || lowerInput.includes('can\'t')) {
            question = "What's getting in the way?";
        } else {
            question = "Tell me more about that.";
        }
        
        const questionDiv = document.createElement('div');
        questionDiv.className = 'frank-response';
        questionDiv.innerHTML = `<p class="clarifying-question">${question}</p>`;
        responseContent.appendChild(questionDiv);
        
        // Add input for answer
        const inputArea = document.createElement('div');
        inputArea.className = 'question-input-area';
        inputArea.innerHTML = `
            <textarea 
                id="questionAnswerInput" 
                class="question-answer-input"
                placeholder="Type your answer here..."
                rows="3"
            ></textarea>
            <button id="questionSubmitBtn" class="question-submit-btn">Respond</button>
        `;
        responseContent.appendChild(inputArea);
        
        const questionInput = document.getElementById('questionAnswerInput');
        const questionSubmitBtn = document.getElementById('questionSubmitBtn');
        
        questionSubmitBtn.addEventListener('click', () => {
            const answer = questionInput.value.trim();
            if (answer) {
                this.lastUserInput = answer;
                this.handleAnswer(answer);
            }
        });
        
        setTimeout(() => questionInput.focus(), 100);
    }

    handleAnswer(answer) {
        // After user responds to first question
        if (!this.conversationState || !this.conversationState.waitingForAnswer) {
            return;
        }

        if (!answer || answer.trim() === '') {
            return;
        }

        // Store the answer and update last input
        this.conversationState.answers.push(answer);
        this.lastUserInput = answer;
        
        const responseContent = document.getElementById('responseContent');
        
        // Remove the input area from current question and show the answer
        const currentQuestion = responseContent.querySelector('.conversation-question');
        if (currentQuestion) {
            const inputArea = currentQuestion.querySelector('.question-input-area');
            if (inputArea) {
                inputArea.remove();
            }
            
            // Show the user's answer
            const answerDiv = document.createElement('div');
            answerDiv.className = 'user-answer';
            answerDiv.innerHTML = `<p><strong>You:</strong> ${answer}</p>`;
            currentQuestion.appendChild(answerDiv);
        }
        
        // Check input type to determine next step
        const inputType = this.detectInputType(answer);
        const mode = this.conversationMode;
        
        // If still emotional/opinion-based, stay in clarifying mode
        if (inputType === 'emotional' && (mode === 'listening' || mode === 'clarifying')) {
            // Use paraphrase mirror instead of "Thanks"
            const mirror = this.createParaphraseMirror(answer);
            
            // Generate clarifying question based on answer
            const lowerAnswer = answer.toLowerCase();
            let nextQuestion;
            
            if (lowerAnswer.includes("doesn't connect") || lowerAnswer.includes("doesnt connect") || 
                lowerAnswer.includes("pointless") || lowerAnswer.includes("irrelevant")) {
                nextQuestion = "Is the problem more that it doesn't connect to your life, or you don't see why you're being asked to do it?";
            } else if (lowerAnswer.includes("boring") || lowerAnswer.includes("dull")) {
                nextQuestion = "What would need to change for it to feel more engaging?";
            } else if (lowerAnswer.includes("hard") || lowerAnswer.includes("difficult") || lowerAnswer.includes("confusing")) {
                nextQuestion = "What part feels the most confusing or overwhelming?";
            } else {
                nextQuestion = "Tell me more about that.";
            }
            
            const responseDiv = document.createElement('div');
            responseDiv.className = 'frank-response';
            responseDiv.innerHTML = `<p>${mirror}</p><p class="clarifying-question">${nextQuestion}</p>`;
            responseContent.appendChild(responseDiv);
            
            // Add contextual buttons for clarification
            const buttonsDiv = document.createElement('div');
            buttonsDiv.className = 'contextual-buttons';
            
            // Generate contextual buttons based on the question
            if (nextQuestion.includes("doesn't connect") || nextQuestion.includes("doesnt connect")) {
                buttonsDiv.innerHTML = `
                    <button class="contextual-btn" data-choice="pointless">It feels pointless</button>
                    <button class="contextual-btn" data-choice="doesnt-matter">I don't get why it matters</button>
                    <button class="contextual-btn" data-choice="something-else">Something else</button>
                `;
            }
            
            if (buttonsDiv.innerHTML) {
                responseContent.appendChild(buttonsDiv);
                
                // Set up button handlers
                buttonsDiv.querySelectorAll('.contextual-btn').forEach(btn => {
                    btn.addEventListener('click', () => {
                        const choice = btn.dataset.choice;
                        this.handleClarificationChoice(choice);
                    });
                });
            }
            
            // Add input for next answer
            const nextInputArea = document.createElement('div');
            nextInputArea.className = 'question-input-area';
            nextInputArea.innerHTML = `
                <textarea 
                    id="questionAnswerInput" 
                    class="question-answer-input"
                    placeholder="Type your answer here..."
                    rows="3"
                ></textarea>
                <button id="questionSubmitBtn" class="question-submit-btn">Respond</button>
            `;
            responseContent.appendChild(nextInputArea);
            
            const questionInput = document.getElementById('questionAnswerInput');
            const questionSubmitBtn = document.getElementById('questionSubmitBtn');
            
            questionSubmitBtn.addEventListener('click', () => {
                const nextAnswer = questionInput.value.trim();
                if (nextAnswer) {
                    this.handleAnswer(nextAnswer);
                }
            });
            
            questionInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && e.ctrlKey) {
                    const nextAnswer = questionInput.value.trim();
                    if (nextAnswer) {
                        this.handleAnswer(nextAnswer);
                    }
                }
            });
            
            setTimeout(() => questionInput.focus(), 100);
            
            // Update mode to clarifying
            this.setConversationMode('clarifying');
            return;
        }
        
        // After clarification, transition to shrinking/stepping mode
        // Use paraphrase mirror, then offer action (but only after clarification)
        const mirror = this.createParaphraseMirror(answer);
        
        // GUARDRAIL: Check if user explicitly signals overwhelm OR selected pause option
        // Only then show regulation/calming language
        const showsOverwhelm = this.detectsOverwhelmSignal(answer);
        const userSelectedPause = this.conversationContext.length > 0 && 
                                 this.conversationContext[this.conversationContext.length - 1]?.userSelectedPause;
        let regulationText = '';
        if (showsOverwhelm || userSelectedPause) {
            // Only show regulation when user explicitly signals overwhelm OR selects pause
            regulationText = '<p class="regulation-suggestion">You can pause whenever you want.</p>';
        }
        
        const responseDiv = document.createElement('div');
        responseDiv.className = 'frank-response';
        responseDiv.innerHTML = `<p>${mirror}</p>${regulationText}`;
        responseContent.appendChild(responseDiv);
        
        // Now offer action buttons (only after clarification)
        this.setConversationMode('shrinking');
        
        // Generate contextual buttons
        const buttons = this.generateContextualButtons('shrinking', answer);
        if (buttons.length > 0) {
            const buttonsDiv = document.createElement('div');
            buttonsDiv.className = 'contextual-buttons';
            buttons.forEach(btn => {
                const btnEl = document.createElement('button');
                btnEl.className = 'contextual-btn';
                btnEl.textContent = btn.text;
                btnEl.dataset.action = btn.action;
                btnEl.addEventListener('click', () => this.handleContextualButton(btn.action));
                buttonsDiv.appendChild(btnEl);
            });
            responseContent.appendChild(buttonsDiv);
        }
    }
    
    handleClarificationChoice(choice) {
        // Handle user's choice from clarification buttons
        this.conversationState.answers.push(choice);
        this.lastUserInput = choice;
        
        // Transition to shrinking mode after clarification
        this.setConversationMode('shrinking');
        
        // Show action options
        const responseContent = document.getElementById('responseContent');
        const actionDiv = document.createElement('div');
        actionDiv.className = 'frank-response';
        actionDiv.innerHTML = '<p>Want to keep going, or should we make this into one tiny step?</p>';
        responseContent.appendChild(actionDiv);
        
        // Add action buttons
        const buttonsDiv = document.createElement('div');
        buttonsDiv.className = 'contextual-buttons';
        buttonsDiv.innerHTML = `
            <button class="contextual-btn" data-action="continue">Want to keep going</button>
            <button class="contextual-btn" data-action="shrink">Make this into one tiny step</button>
        `;
        responseContent.appendChild(buttonsDiv);
        
        buttonsDiv.querySelectorAll('.contextual-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.handleContextualButton(btn.dataset.action);
            });
        });
    }

    revealFirstStepOnly() {
        // Presenting first step only - no generic "Here's a good place to start"
        const responseContent = document.getElementById('responseContent');
        const breakdown = this.generateBreakdown(this.conversationState.originalInput, 'resilience_help');
        
        // Store all steps but only show first 2 (first clearly, second faint preview)
        this.conversationState.adviceSteps = breakdown.steps;
        this.conversationState.currentAdviceStep = 0;
        this.conversationState.adviceAnswers = [];
        
        // No generic acknowledgements - just show the step
        const adviceDiv = document.createElement('div');
        adviceDiv.className = 'advice-reveal';
        adviceDiv.innerHTML = `
            <div class="resilience-advice" id="resilienceAdviceContainer">
            </div>
        `;
        
        responseContent.appendChild(adviceDiv);
        
        // Show first step (clearly) and second step (faint preview)
        this.showFirstStepWithPreview();
    }

    revealAdvice() {
        // This is called when continuing after first step
        const responseContent = document.getElementById('responseContent');
        const breakdown = this.generateBreakdown(this.conversationState.originalInput, 'resilience_help');
        
        this.conversationState.adviceSteps = breakdown.steps;
        this.conversationState.currentAdviceStep = 0;
        this.conversationState.adviceAnswers = [];
        
        const adviceDiv = document.createElement('div');
        adviceDiv.className = 'advice-reveal';
        adviceDiv.innerHTML = `
            <div class="resilience-advice" id="resilienceAdviceContainer">
            </div>
        `;
        
        responseContent.appendChild(adviceDiv);
        
        this.showNextAdviceStep();
    }

    showFirstStepWithPreview() {
        // Show Step 1 (clearly) and Step 2 (faint preview)
        const container = document.getElementById('resilienceAdviceContainer');
        if (!container || !this.conversationState.adviceSteps) return;
        
        // Step 1 - clearly visible
        const step1 = this.conversationState.adviceSteps[0];
        const step1Div = document.createElement('div');
        step1Div.className = 'advice-card step-current';
        step1Div.setAttribute('data-step-index', 0);
        
        let step1HTML = `
            <h4 class="advice-title">${step1.title}</h4>
            <p class="advice-text">${step1.description}</p>
        `;
        
        // Only show feedback buttons if mode allows and user input suggests they're needed
        const mode = this.conversationMode;
        const lastInput = this.lastUserInput || '';
        const shouldShowFeedback = mode === 'stepping' || mode === 'shrinking';
        
        // Only show "Take a breath" if user explicitly signals overwhelm
        if (step1.title === "Take a Breath" && !this.detectsOverwhelmSignal(lastInput)) {
            // Skip this step if no overwhelm signal
            if (this.conversationState.adviceSteps.length > 1) {
                this.conversationState.currentAdviceStep = 1;
                this.showFirstStepWithPreview();
                return;
            }
        }
        
        if (shouldShowFeedback) {
            // Generate contextual buttons based on last input
            const contextualButtons = this.generateContextualButtons(mode, lastInput);
            if (contextualButtons.length > 0) {
                step1HTML += '<div class="step-feedback-actions">';
                contextualButtons.forEach(btn => {
                    step1HTML += `<button class="step-feedback-btn" data-action="${btn.action}">${btn.text}</button>`;
                });
                step1HTML += '</div>';
            } else {
                // Default feedback buttons only if no contextual ones
                step1HTML += `
                    <div class="step-feedback-actions">
                        <button class="step-feedback-btn" data-action="make-smaller">Make this smaller</button>
                        <button class="step-feedback-btn" data-action="too-much">This is too much</button>
                    </div>
                `;
            }
        }
        
        if (step1.needsInput) {
            step1HTML += `
                <div class="advice-input-area">
                    <p class="advice-input-prompt">${step1.inputPrompt}</p>
                    <textarea 
                        class="advice-step-input"
                        placeholder="${step1.inputPlaceholder}"
                        rows="3"
                    ></textarea>
                </div>
            `;
        }
        
        step1Div.innerHTML = step1HTML;
        container.appendChild(step1Div);
        
        // Step 2 - faint preview (if exists)
        if (this.conversationState.adviceSteps.length > 1) {
            const step2 = this.conversationState.adviceSteps[1];
            const step2Div = document.createElement('div');
            step2Div.className = 'advice-card step-next';
            step2Div.setAttribute('data-step-index', 1);
            step2Div.innerHTML = `
                <h4 class="advice-title">${step2.title}</h4>
                <p class="advice-text">${step2.description}</p>
            `;
            container.appendChild(step2Div);
        }
        
        // Set up Step 1 actions
        this.setupStepActions(step1Div, step1, 0);
        
        // Scroll to first step
        setTimeout(() => {
            step1Div.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }, 100);
    }

    setupStepActions(stepDiv, step, stepIndex) {
        // Set up feedback buttons
        const feedbackBtns = stepDiv.querySelectorAll('.step-feedback-btn');
        feedbackBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                this.handleStepFeedback(btn.dataset.action, stepDiv, step);
            });
        });
        
        // Set up input handler if needed
        if (step.needsInput) {
            const inputField = stepDiv.querySelector('.advice-step-input');
            const inputArea = stepDiv.querySelector('.advice-input-area');
            
            // Primary action: "Start this step" button
            const startBtn = document.createElement('button');
            startBtn.className = 'advice-start-btn primary-btn';
            startBtn.textContent = 'Start this step';
            inputArea.appendChild(startBtn);
            
            startBtn.addEventListener('click', () => {
                const answer = inputField.value.trim();
                if (answer) {
                    this.conversationState.adviceAnswers.push({
                        step: step.title,
                        answer: answer
                    });
                    this.advanceToNextStep(stepDiv, step);
                }
            });
            
            inputField.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && e.ctrlKey && inputField.value.trim()) {
                    startBtn.click();
                }
            });
            
            setTimeout(() => inputField.focus(), 100);
        } else {
            // For non-input steps, add "Start this step" button
            const startBtn = document.createElement('button');
            startBtn.className = 'advice-start-btn primary-btn';
            startBtn.textContent = 'Start this step';
            stepDiv.appendChild(startBtn);
            
            startBtn.addEventListener('click', () => {
                this.advanceToNextStep(stepDiv, step);
            });
        }
    }

    showNextAdviceStep() {
        if (!this.conversationState || !this.conversationState.adviceSteps) {
            return;
        }
        
        const container = document.getElementById('resilienceAdviceContainer');
        
        // Update visual states: current step fully lit, next step faint glow, future steps hidden
        this.updateStepVisualStates(container);
        
        if (this.conversationState.currentAdviceStep < this.conversationState.adviceSteps.length) {
            const step = this.conversationState.adviceSteps[this.conversationState.currentAdviceStep];
            
            const stepDiv = document.createElement('div');
            stepDiv.className = 'advice-card step-current';
            stepDiv.setAttribute('data-step-index', this.conversationState.currentAdviceStep);
            
            let stepHTML = `
                <h4 class="advice-title">${step.title}</h4>
                <p class="advice-text">${step.description}</p>
            `;
            
            // Add contextual feedback buttons based on mode and last input
            const mode = this.conversationMode;
            const lastInput = this.lastUserInput || '';
            const shouldShowFeedback = mode === MODES.STEPPING || mode === 'stepping' || 
                                      mode === MODES.OFFERING_DIRECTION || mode === MODES.SHRINKING || 
                                      mode === 'shrinking' || mode === 'offering_direction';
            
            if (shouldShowFeedback) {
                const contextualButtons = this.generateContextualButtons(mode, lastInput);
                if (contextualButtons.length > 0) {
                    stepHTML += '<div class="step-feedback-actions">';
                    contextualButtons.forEach(btn => {
                        stepHTML += `<button class="step-feedback-btn" data-action="${btn.action}">${btn.text}</button>`;
                    });
                    stepHTML += '</div>';
                } else {
                    // Default feedback buttons only if no contextual ones
                    stepHTML += `
                        <div class="step-feedback-actions">
                            <button class="step-feedback-btn" data-action="make-smaller">Make this smaller</button>
                            <button class="step-feedback-btn" data-action="too-much">This is too much</button>
                        </div>
                    `;
                }
            }
            
            // Add input field if this step needs input
            if (step.needsInput) {
                stepHTML += `
                    <div class="advice-input-area">
                        <p class="advice-input-prompt">${step.inputPrompt}</p>
                        <textarea 
                            class="advice-step-input"
                            placeholder="${step.inputPlaceholder}"
                            rows="3"
                        ></textarea>
                    </div>
                `;
            }
            
            stepDiv.innerHTML = stepHTML;
            container.appendChild(stepDiv);
            
            // Set up feedback button handlers
            const feedbackBtns = stepDiv.querySelectorAll('.step-feedback-btn');
            feedbackBtns.forEach(btn => {
                btn.addEventListener('click', () => {
                    this.handleStepFeedback(btn.dataset.action, stepDiv, step);
                });
            });
            
            // Set up input handler if needed
            if (step.needsInput) {
                const inputField = stepDiv.querySelector('.advice-step-input');
                const inputArea = stepDiv.querySelector('.advice-input-area');
                
                // Add Respond button
                const respondBtn = document.createElement('button');
                respondBtn.className = 'advice-respond-btn';
                respondBtn.textContent = 'Respond';
                inputArea.appendChild(respondBtn);
                
                // Handle respond button click
                respondBtn.addEventListener('click', () => {
                    const answer = inputField.value.trim();
                    if (answer) {
                        // Store answer
                        this.conversationState.adviceAnswers.push({
                            step: step.title,
                            answer: answer
                        });
                        this.advanceToNextStep(stepDiv, step);
                    } else {
                        alert('Please share your thoughts before clicking Respond.');
                    }
                });
                
                // Also allow Enter+Ctrl to advance
                inputField.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' && e.ctrlKey && inputField.value.trim()) {
                        respondBtn.click();
                    }
                });
                
                // Focus input
                setTimeout(() => {
                    inputField.focus();
                }, 100);
            } else {
                // For non-input steps, add a Continue button
                const continueBtn = document.createElement('button');
                continueBtn.className = 'advice-continue-btn';
                continueBtn.textContent = 'Continue';
                stepDiv.appendChild(continueBtn);
                
                continueBtn.addEventListener('click', () => {
                    this.advanceToNextStep(stepDiv, step);
                });
            }
            
            // Scroll to new step
            setTimeout(() => {
                stepDiv.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }, 100);
        } else {
            // All steps shown, complete the flow
            this.completeAdviceFlow();
        }
    }

    updateStepVisualStates(container) {
        // Path-based step view: current fully lit, next faint glow, future hidden
        const allSteps = container.querySelectorAll('.advice-card');
        allSteps.forEach((step, index) => {
            step.classList.remove('step-current', 'step-next', 'step-future');
            
            if (index === this.conversationState.currentAdviceStep) {
                step.classList.add('step-current');
            } else if (index === this.conversationState.currentAdviceStep + 1) {
                step.classList.add('step-next');
            } else if (index > this.conversationState.currentAdviceStep + 1) {
                step.classList.add('step-future');
            }
        });
    }

    handleStepFeedback(action, stepDiv, step) {
        // Feedback Loop - Use paraphrase mirror, then adapt
        if (action === 'too-much') {
            // Use user's language instead of "Thanks"
            const lastInput = this.lastUserInput || '';
            const mirror = lastInput ? this.createParaphraseMirror(lastInput) : "I hear you.";
            
            const feedbackMsg = document.createElement('div');
            feedbackMsg.className = 'step-feedback-message';
            feedbackMsg.innerHTML = `<p>${mirror} Let's make it easier.</p>`;
            
            const inputArea = stepDiv.querySelector('.advice-input-area');
            if (inputArea) {
                stepDiv.insertBefore(feedbackMsg, inputArea);
            } else {
                stepDiv.appendChild(feedbackMsg);
            }
            
            // Adapt: Break down or offer alternative
            setTimeout(() => {
                this.adaptStepForFeedback(stepDiv, step, action);
            }, 1000);
        } else if (action === 'make-smaller') {
            // Break the step down further - no generic "Let's break this"
            const feedbackMsg = document.createElement('div');
            feedbackMsg.className = 'step-feedback-message';
            feedbackMsg.innerHTML = `<p>Let's break this into even smaller pieces.</p>`;
            
            const inputArea = stepDiv.querySelector('.advice-input-area');
            if (inputArea) {
                stepDiv.insertBefore(feedbackMsg, inputArea);
            } else {
                stepDiv.appendChild(feedbackMsg);
            }
            
            setTimeout(() => {
                this.adaptStepForFeedback(stepDiv, step, action);
            }, 1000);
        }
    }

    adaptStepForFeedback(stepDiv, step, action) {
        // Adapt the step based on feedback (metacognitive: help user recognize when strategies aren't working)
        if (action === 'too-much') {
            // Offer alternative phrasing or suggest pause
            const adaptDiv = document.createElement('div');
            adaptDiv.className = 'step-adaptation';
            adaptDiv.innerHTML = `
                <p>Would it help to pause here, or would you like me to rephrase this step differently? Recognizing when something feels like too much is actually useful information - it tells you what approach might work better.</p>
            `;
            stepDiv.appendChild(adaptDiv);
        } else if (action === 'make-smaller') {
            // Break down further (metacognitive: help user understand when to adapt strategy)
            const adaptDiv = document.createElement('div');
            adaptDiv.className = 'step-adaptation';
            adaptDiv.innerHTML = `
                <p>Let's focus on just one tiny part. What's the smallest piece you could tackle? Sometimes breaking things down further is the right strategy - you're adapting your approach based on what you're noticing.</p>
            `;
            stepDiv.appendChild(adaptDiv);
        }
    }

    advanceToNextStep(currentStepDiv, currentStep) {
        // Mark current step as complete with celebration
        currentStepDiv.classList.remove('step-current');
        currentStepDiv.classList.add('step-complete');
        
        // Show quiet acknowledgment (no generic praise)
        const celebrations = ["One step done.", "That mattered."];
        const celebration = celebrations[Math.floor(Math.random() * celebrations.length)];
        this.showStepCelebration(currentStepDiv, celebration);
        
        // Brief ambient glow pulse
        document.body.classList.add('celebration-pulse');
        setTimeout(() => {
            document.body.classList.remove('celebration-pulse');
        }, 1000);
        
        // Metacognitive prompt: Help user evaluate their strategy
        setTimeout(() => {
            this.addMetacognitiveReflection(currentStepDiv);
        }, 1500);
        
        // Ask "Want to keep going?" after celebration
        setTimeout(() => {
            this.askWantToKeepGoing(currentStepDiv);
        }, 2000);
    }
    
    addMetacognitiveReflection(stepDiv) {
        // Add a subtle metacognitive reflection prompt
        const reflectionDiv = document.createElement('div');
        reflectionDiv.className = 'metacognitive-prompt';
        reflectionDiv.style.cssText = 'font-size: 0.9em; color: #666; margin-top: 8px; font-style: italic;';
        reflectionDiv.innerHTML = `<p>Quick check: Did this approach work for you? (This helps you learn what strategies fit you best.)</p>`;
        
        // Insert before any existing nudge
        const existingNudge = stepDiv.querySelector('.keep-going-nudge');
        if (existingNudge) {
            stepDiv.insertBefore(reflectionDiv, existingNudge);
        } else {
            stepDiv.appendChild(reflectionDiv);
        }
    }

    askWantToKeepGoing(completedStepDiv) {
        // EXACT COPY: "Want to keep going?"
        const nudgeDiv = document.createElement('div');
        nudgeDiv.className = 'keep-going-nudge';
        nudgeDiv.innerHTML = `
            <p class="nudge-question">Want to keep going?</p>
            <div class="nudge-options">
                <button class="nudge-btn nudge-yes">Yes</button>
                <button class="nudge-btn nudge-not-now">Not right now</button>
            </div>
        `;
        
        completedStepDiv.appendChild(nudgeDiv);
        
        // Handle nudge responses
        nudgeDiv.querySelector('.nudge-yes').addEventListener('click', () => {
            nudgeDiv.remove();
            this.conversationState.currentAdviceStep++;
            this.showNextAdviceStep();
        });
        
        nudgeDiv.querySelector('.nudge-not-now').addEventListener('click', () => {
            // Permission-based statement instead of generic "That's okay"
            nudgeDiv.innerHTML = `
                <p class="nudge-response">You can come back whenever you're ready.</p>
            `;
            // Then stops talking - save and close
            setTimeout(() => {
                this.pauseAndSave();
                this.closeModal();
            }, 2000);
        });
    }

    showStepCelebration(stepDiv, message) {
        // Remove generic praise - use quiet acknowledgment only
        const celebrationDiv = document.createElement('div');
        celebrationDiv.className = 'step-celebration';
        celebrationDiv.textContent = message;
        stepDiv.appendChild(celebrationDiv);
        
        // Remove after animation
        setTimeout(() => {
            celebrationDiv.remove();
        }, 2000);
    }

    completeAdviceFlow() {
        // Show main input section again
        const mainInputSection = document.querySelector('.main-input-section');
        if (mainInputSection) {
            mainInputSection.style.display = '';
        }
        
        // Reset main input and button
        const inputField = document.getElementById('assignmentInput');
        inputField.value = '';
        inputField.placeholder = 'Messy is fine, add your assignment or random thoughts here';
        
        const submitBtn = document.getElementById('submitBtn');
        submitBtn.textContent = 'Help me get started';
        
        // Close modal
        this.closeModal();
        
        // Reset conversation state
        this.conversationState = null;
    }

    displayResponse(breakdown, type = 'general') {
        const responseHeader = document.getElementById('responseHeader');
        const responseContent = document.getElementById('responseContent');
        
        // Open modal instead of showing inline
        this.openModal();
        
        // Show header and middle sections only for assignments
        if (type !== 'resilience_help') {
            this.showMiddleSections();
            if (responseHeader) {
                responseHeader.style.display = '';
            }
        } else {
            // Hide header for resilience help
            if (responseHeader) {
                responseHeader.style.display = 'none';
            }
        }

        // Check if this is resilience help - render it differently
        const isResilienceHelp = breakdown.type === 'resilience_help' || type === 'resilience_help';

        let html = `
            <div class="persona-message">${breakdown.personaMessage}</div>
            
            <div class="how-to-start">
                <h3>${breakdown.howToStart.title}</h3>
                <p>${breakdown.howToStart.content}</p>
            </div>
        `;

        if (isResilienceHelp) {
            // Render resilience help as friendly advice cards, not structured steps
            html += `<div class="resilience-advice">`;
            breakdown.steps.forEach((step, index) => {
                html += `
                    <div class="advice-card">
                        <h4 class="advice-title">${step.title}</h4>
                        <p class="advice-text">${step.description}</p>
                    </div>
                `;
            });
            html += `</div>`;
        } else {
            // Render assignment help with structured steps and checklists
            html += `
                <div class="guide-section">
                    <h3>Your Step-by-Step Plan</h3>
                    <ol class="steps-list">
            `;

            breakdown.steps.forEach((step, index) => {
                const stepId = `step-${index}`;
                html += `
                    <li class="step-item">
                        <div class="step-title">${step.title}</div>
                        <div class="step-description">${step.description}</div>
                        ${step.analogy ? `<div class="step-description" style="font-style: italic; color: var(--accent-blue); margin-top: 0.5rem;">💭 ${step.analogy}</div>` : ''}
                        <div class="checklist">
                            ${step.checklist.map((item, itemIndex) => `
                                <div class="checklist-item">
                                    <input type="checkbox" id="${stepId}-${itemIndex}" onchange="app.updateProgress(); app.toggleChecklistItem(this)">
                                    <label for="${stepId}-${itemIndex}">${item}</label>
                                </div>
                            `).join('')}
                        </div>
                    </li>
                `;
            });

            html += `
                    </ol>
                </div>
            `;
        }

        responseContent.innerHTML = html;
        
        // Restore progress if this is a loaded assignment
        if (this.currentProgress) {
            this.restoreProgress(this.currentProgress);
            this.currentProgress = null;
        }
        
        // Highlight the first uncompleted step
        this.highlightActiveStep();
        
        // Show "Nice start" message
        this.showNiceStart();
    }

    showNiceStart() {
        // Only show "Nice start" for assignment types, not emotional/resilience help
        const mode = this.conversationMode;
        if (mode === 'listening' || mode === 'clarifying') {
            return; // Don't show generic praise in listening/clarifying modes
        }
        
        const niceStartMsg = document.getElementById('niceStartMessage');
        if (niceStartMsg) {
            niceStartMsg.classList.remove('hidden');
            // Fade in
            setTimeout(() => {
                niceStartMsg.style.opacity = '1';
            }, 100);
        }
    }

    highlightActiveStep() {
        // Remove active class from all steps
        const allSteps = document.querySelectorAll('.step-item');
        allSteps.forEach(step => step.classList.remove('active-step'));
        
        // Find the first step with unchecked items
        const steps = document.querySelectorAll('.step-item');
        for (let step of steps) {
            const checkboxes = step.querySelectorAll('input[type="checkbox"]');
            const allChecked = Array.from(checkboxes).every(cb => cb.checked);
            
            if (!allChecked) {
                step.classList.add('active-step');
                // Scroll to active step smoothly
                setTimeout(() => {
                    step.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }, 100);
                break;
            }
        }
    }

    restoreProgress(progress) {
        Object.keys(progress).forEach(checkboxId => {
            const checkbox = document.getElementById(checkboxId);
            if (checkbox) {
                checkbox.checked = true;
                const checklistItem = checkbox.closest('.checklist-item');
                if (checklistItem) {
                    checklistItem.classList.add('completed');
                }
            }
        });
    }

    updateProgress() {
        // This can be enhanced to show progress percentage
        const checkboxes = document.querySelectorAll('.checklist-item input[type="checkbox"]');
        const checked = document.querySelectorAll('.checklist-item input[type="checkbox"]:checked');
        // Could add a progress bar here if desired
    }

    toggleChecklistItem(checkbox) {
        const checklistItem = checkbox.closest('.checklist-item');
        if (checkbox.checked) {
            checklistItem.classList.add('completed');
        } else {
            checklistItem.classList.remove('completed');
        }
        // Update active step highlighting
        this.highlightActiveStep();
    }

    getCurrentProgress() {
        const progress = {};
        const checkboxes = document.querySelectorAll('.checklist-item input[type="checkbox"]');
        checkboxes.forEach(checkbox => {
            if (checkbox.checked) {
                progress[checkbox.id] = true;
            }
        });
        return progress;
    }

    pauseAndSave() {
        if (!this.currentAssignment) {
            return;
        }

        const progress = this.getCurrentProgress();
        const assignmentData = {
            id: Date.now(),
            text: this.currentAssignment,
            date: new Date().toLocaleDateString(),
            completed: false,
            progress: progress,
            paused: true,
            adviceAnswers: this.conversationState ? this.conversationState.adviceAnswers : [],
            currentAdviceStep: this.conversationState ? this.conversationState.currentAdviceStep : 0
        };

        // Check if assignment already exists and update it, otherwise add new
        const existingIndex = this.savedAssignments.findIndex(a => a.text === this.currentAssignment);
        if (existingIndex !== -1) {
            this.savedAssignments[existingIndex] = assignmentData;
        } else {
            this.savedAssignments.push(assignmentData);
        }
        
        this.saveToLocalStorage();
        this.renderSavedAssignments();
        
        // Feature Set 4: When user stops, say once quietly, then get out of the way
        // Quiet reassurance - no loud message, just gentle acknowledgment
        this.showMicrocopyMessage('You can come back whenever you\'re ready.');
        
        // Close modal and clear
        this.closeModal();
        document.getElementById('assignmentInput').value = '';
        this.currentAssignment = null;
        this.conversationState = null;
    }

    saveCurrentAssignment() {
        if (!this.currentAssignment) {
            alert('No assignment to save!');
            return;
        }

        const progress = this.getCurrentProgress();
        const assignmentData = {
            id: Date.now(),
            text: this.currentAssignment,
            date: new Date().toLocaleDateString(),
            completed: false,
            progress: progress,
            paused: false
        };

        this.savedAssignments.push(assignmentData);
        this.saveToLocalStorage();
        this.renderSavedAssignments();
        
        // Show encouraging message
        this.showMicrocopyMessage('You can come back to this anytime.');
    }

    loadSavedAssignments() {
        const saved = localStorage.getItem('savedAssignments');
        return saved ? JSON.parse(saved) : [];
    }

    saveToLocalStorage() {
        localStorage.setItem('savedAssignments', JSON.stringify(this.savedAssignments));
    }

    renderSavedAssignments() {
        const savedList = document.getElementById('savedList');
        
        if (this.savedAssignments.length === 0) {
            savedList.innerHTML = '<div class="empty-state">No saved assignments yet. Save one to see it here!</div>';
            return;
        }

        savedList.innerHTML = this.savedAssignments.map(assignment => `
            <div class="saved-item" onclick="app.loadAssignment(${assignment.id})">
                <div class="saved-item-header">
                    <div class="saved-item-title">${this.truncateText(assignment.text, 60)}</div>
                    <button class="delete-btn" onclick="event.stopPropagation(); app.deleteAssignment(${assignment.id})" title="Delete">×</button>
                </div>
                <div class="saved-item-preview">
                    ${assignment.paused ? '⏸️ Paused - ' : ''}Saved on ${assignment.date}
                </div>
            </div>
        `).join('');
    }

    loadAssignment(id) {
        const assignment = this.savedAssignments.find(a => a.id === id);
        if (assignment) {
            // Feature Set 4: Welcome back flow with choice
            // Show welcome message with progress acknowledgment and choice
            this.showWelcomeBack(assignment);
        }
    }

    showWelcomeBack(assignment) {
        // EXACT COPY: Welcome back flow
        const welcomeMsg = document.createElement('div');
        welcomeMsg.className = 'welcome-back-message';
        
        // Check if there's saved progress
        const hasProgress = assignment.progress || assignment.adviceAnswers || assignment.currentAdviceStep > 0;
        
        if (hasProgress) {
            // EXACT COPY: "Welcome back. You already made progress."
            welcomeMsg.innerHTML = `
                <p class="welcome-back-text">Welcome back. You already made progress.</p>
            `;
            
            document.body.appendChild(welcomeMsg);
            
            // Completed steps briefly glow once
            document.body.classList.add('welcome-back-pulse');
            
            // Then show choice
            setTimeout(() => {
                welcomeMsg.innerHTML = `
                    <p class="welcome-back-text">Welcome back. You already made progress.</p>
                    <p class="welcome-back-question">What would you like to do?</p>
                    <div class="welcome-back-choices">
                        <button class="welcome-back-btn continue-btn">Continue where I left off</button>
                        <button class="welcome-back-btn start-fresh-btn">Start fresh</button>
                    </div>
                `;
                
                // Handle choice buttons
                welcomeMsg.querySelector('.continue-btn').addEventListener('click', () => {
                    welcomeMsg.remove();
                    document.body.classList.remove('welcome-back-pulse');
                    this.loadAssignmentWithProgress(assignment);
                });
                
                welcomeMsg.querySelector('.start-fresh-btn').addEventListener('click', () => {
                    welcomeMsg.remove();
                    document.body.classList.remove('welcome-back-pulse');
                    this.startFresh(assignment);
                });
            }, 2000);
        } else {
            welcomeMsg.innerHTML = `
                <p class="welcome-back-text">Welcome back. You already made progress.</p>
            `;
            document.body.appendChild(welcomeMsg);
            document.body.classList.add('welcome-back-pulse');
            setTimeout(() => {
                welcomeMsg.remove();
                document.body.classList.remove('welcome-back-pulse');
            }, 3000);
        }
    }

    loadAssignmentWithProgress(assignment) {
        // Load assignment and restore progress
        document.getElementById('assignmentInput').value = assignment.text;
        this.currentAssignment = assignment.text;
        
        if (assignment.progress) {
            this.currentProgress = assignment.progress;
        }
        
        // Restore conversation state if it was a resilience help flow
        if (assignment.adviceAnswers) {
            this.conversationState = {
                originalInput: assignment.text,
                adviceAnswers: assignment.adviceAnswers,
                currentAdviceStep: assignment.currentAdviceStep || 0,
                adviceSteps: null // Will be regenerated
            };
        }
        
        this.processAssignment();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    startFresh(assignment) {
        // Start fresh - clear saved progress and reprocess
        document.getElementById('assignmentInput').value = assignment.text;
        this.currentAssignment = assignment.text;
        this.currentProgress = null;
        this.conversationState = null;
        
        // Remove the saved assignment to start fresh
        this.savedAssignments = this.savedAssignments.filter(a => a.id !== assignment.id);
        this.saveToLocalStorage();
        this.renderSavedAssignments();
        
        // Process as new
        this.processAssignment();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    showMicrocopyMessage(message) {
        // Create or update microcopy message element
        let msgElement = document.getElementById('microcopyToast');
        if (!msgElement) {
            msgElement = document.createElement('div');
            msgElement.id = 'microcopyToast';
            msgElement.className = 'microcopy-toast';
            document.body.appendChild(msgElement);
        }
        
        msgElement.textContent = message;
        msgElement.classList.add('show');
        
        // Hide after 3 seconds
        setTimeout(() => {
            msgElement.classList.remove('show');
        }, 3000);
    }

    deleteAssignment(id) {
        if (confirm('Are you sure you want to delete this assignment?')) {
            this.savedAssignments = this.savedAssignments.filter(a => a.id !== id);
            this.saveToLocalStorage();
            this.renderSavedAssignments();
        }
    }

    truncateText(text, maxLength) {
        return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
    }

    initFunFacts() {
        // Load initial fact
        this.loadFunFact();
        
        // Set up timer to update every hour (3600000 ms)
        this.funFactTimer = setInterval(() => {
            this.loadFunFact();
        }, 3600000); // 1 hour
        
        // Track user activity to keep timer running
        document.addEventListener('click', () => this.resetFunFactTimer());
        document.addEventListener('keydown', () => this.resetFunFactTimer());
    }

    resetFunFactTimer() {
        // Reset timer on user interaction
        if (this.funFactTimer) {
            clearInterval(this.funFactTimer);
        }
        this.funFactTimer = setInterval(() => {
            this.loadFunFact();
        }, 3600000);
    }

    async loadFunFact() {
        // Curated animal facts inspired by National Geographic Kids
        const animalFacts = [
            {
                fact: "Octopuses have three hearts! Two pump blood to the gills, and one pumps blood to the rest of the body.",
                animal: "Octopus"
            },
            {
                fact: "A group of flamingos is called a 'flamboyance' - and they can sleep standing on one leg!",
                animal: "Flamingo"
            },
            {
                fact: "Dolphins have names for each other! They use unique whistles to identify themselves and call out to friends.",
                animal: "Dolphin"
            },
            {
                fact: "Penguins can drink saltwater! They have special glands that filter out the salt from seawater.",
                animal: "Penguin"
            },
            {
                fact: "Elephants can recognize themselves in a mirror - one of the few animals that can! They're also afraid of bees.",
                animal: "Elephant"
            },
            {
                fact: "Sharks have been around for over 400 million years - that's older than trees and dinosaurs!",
                animal: "Shark"
            },
            {
                fact: "Butterflies taste with their feet! They have taste receptors on their feet to help them find the right plants.",
                animal: "Butterfly"
            },
            {
                fact: "A blue whale's heart is so big, a human could swim through its arteries! It's the size of a small car.",
                animal: "Blue Whale"
            },
            {
                fact: "Crocodiles can't stick out their tongues! Their tongues are attached to the bottom of their mouths.",
                animal: "Crocodile"
            },
            {
                fact: "Honeybees can recognize human faces! They use the same technique humans do to remember faces.",
                animal: "Honeybee"
            },
            {
                fact: "Sloths only poop once a week! They come down from trees to do it, which is when they're most vulnerable.",
                animal: "Sloth"
            },
            {
                fact: "Polar bears have black skin under their white fur! This helps them absorb heat from the sun.",
                animal: "Polar Bear"
            },
            {
                fact: "Jellyfish don't have brains, hearts, or bones! They're 95% water and have been around for 500 million years.",
                animal: "Jellyfish"
            },
            {
                fact: "Owls can rotate their heads 270 degrees! They can't move their eyes, so they turn their whole head instead.",
                animal: "Owl"
            },
            {
                fact: "Giraffes only need 5 to 30 minutes of sleep per day! They take short naps standing up.",
                animal: "Giraffe"
            },
            {
                fact: "Sea otters hold hands while sleeping so they don't drift apart! They also have the densest fur of any animal.",
                animal: "Sea Otter"
            },
            {
                fact: "Tigers have striped skin, not just striped fur! Even if you shaved a tiger, you'd still see the stripes.",
                animal: "Tiger"
            },
            {
                fact: "Kangaroos can't walk backwards! Their tail and legs make it impossible for them to move in reverse.",
                animal: "Kangaroo"
            },
            {
                fact: "Chameleons can move their eyes independently! Each eye can look in a different direction at the same time.",
                animal: "Chameleon"
            },
            {
                fact: "Wolves can hear sounds up to 6 miles away in the forest! Their hearing is 20 times better than humans.",
                animal: "Wolf"
            }
        ];

        // Get a fact based on the current hour to ensure variety
        const hour = new Date().getHours();
        const factIndex = hour % animalFacts.length;
        const selectedFact = animalFacts[factIndex];

        // Update the display
        const factText = document.querySelector('.fun-fact-text');
        const factSource = document.querySelector('.fun-fact-source');
        
        if (factText && factSource) {
            factText.textContent = selectedFact.fact;
            factSource.textContent = `Source: National Geographic Kids • About ${selectedFact.animal}s`;
            
            // Add a subtle animation
            factText.style.opacity = '0';
            setTimeout(() => {
                factText.style.transition = 'opacity 0.5s ease';
                factText.style.opacity = '1';
            }, 100);
        }
    }
}

// Initialize the app when DOM is ready
function initializeApp() {
    console.log('Initializing app...');
    try {
        window.app = new AssignmentHelper();
        console.log('App initialized successfully');
    } catch (error) {
        console.error('Error initializing app:', error);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApp);
} else {
    // DOM is already ready
    initializeApp();
}

