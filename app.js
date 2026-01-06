// Frank - Assignment Helper App

// Conversation modes (final set)
const MODES = {
    LISTENING: 'listening',
    CLARIFYING: 'clarifying',
    SHRINKING: 'shrinking',
    STEPPING: 'stepping',
    PAUSED: 'paused'
};

class AssignmentHelper {
    constructor() {
        this.savedAssignments = this.loadSavedAssignments();
        this.currentAssignment = null;
        this.currentProgress = null;
        this.funFactTimer = null;
        this.conversationState = null; // Track question-answer flow for resilience help
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
    
    // Classify user input into signal types
    classifyInput(userInput) {
        const lowerInput = userInput.toLowerCase();
        
        // Check for overwhelmed signal first (highest priority)
        const overwhelmSignals = [
            'i can\'t', 'i cannot', 'too much', 'too hard', 'i give up',
            'this is too much', 'can\'t do this', 'cannot do this',
            'shutdown', 'shut down', 'freeze', 'frozen', 'stuck', 'trapped',
            'i\'m done', 'im done', 'can\'t handle', 'cannot handle'
        ];
        if (overwhelmSignals.some(signal => lowerInput.includes(signal))) {
            return { type: 'overwhelmed', input: userInput };
        }
        
        // Check for request to shrink
        const shrinkSignals = [
            'make it smaller', 'break it down', 'too big', 'too large',
            'smaller steps', 'tiny step', 'one step', 'simpler'
        ];
        if (shrinkSignals.some(signal => lowerInput.includes(signal))) {
            return { type: 'request_to_shrink', input: userInput };
        }
        
        // Check for ready for action (after clarification)
        if (this.conversationMode === MODES.CLARIFYING || this.conversationMode === MODES.SHRINKING) {
            // If we're in clarifying/shrinking mode and user responds, they're ready
            if (userInput.trim().length > 0) {
                return { type: 'ready_for_action', input: userInput };
            }
        }
        
        // Check for explanatory patterns
        const explanatoryPatterns = [
            /it doesn't feel/i,
            /it doesnt feel/i,
            /it doesn't seem/i,
            /it doesnt seem/i,
            /because/i,
            /the problem is/i,
            /what's wrong is/i,
            /whats wrong is/i,
            /doesn't connect/i,
            /doesnt connect/i,
            /not relevant/i,
            /irrelevant/i
        ];
        if (explanatoryPatterns.some(pattern => pattern.test(userInput))) {
            return { type: 'explanatory', input: userInput };
        }
        
        // Check for emotional indicators
        const emotionalKeywords = [
            'hate', 'love', 'feel', 'feeling', 'frustrated', 'anxious', 'stressed',
            'overwhelmed', 'stuck', 'difficult', 'hard', 'sucks', 'boring', 'pointless',
            'useless', 'waste of time', 'don\'t care', 'dont care',
            'impossible', 'too much', 'too hard'
        ];
        if (emotionalKeywords.some(keyword => lowerInput.includes(keyword))) {
            return { type: 'emotional', input: userInput };
        }
        
        // Check for action-oriented (assignment) input
        const assignmentKeywords = [
            'assignment', 'essay', 'paper', 'write a', 'write an', 'read the', 
            'read a', 'read an', 'book report', 'compare', 'contrast', 'analyze',
            'research paper', 'research project', 'homework assignment', 'due date',
            'how do i', 'how to', 'what should i', 'help me', 'show me', 'explain',
            'break down', 'steps', 'guide', 'walk me through'
        ];
        if (assignmentKeywords.some(keyword => lowerInput.includes(keyword))) {
            return { type: 'ready_for_action', input: userInput };
        }
        
        // Default: treat as emotional if short, otherwise as ready for action
        if (userInput.split(' ').length < 10) {
            return { type: 'emotional', input: userInput };
        }
        
        return { type: 'ready_for_action', input: userInput };
    }
    
    // Detect if user explicitly signals overwhelm/shutdown
    detectsOverwhelmSignal(input) {
        if (!input) return false;
        const lowerInput = input.toLowerCase();
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
     */
    
    // Canonical response flow
    generateFrankResponse(userInput, context = {}) {
        const signal = this.classifyInput(userInput);
        this.lastUserInput = userInput;
        
        // Add to conversation context
        this.conversationContext.push({
            input: userInput,
            signal: signal.type,
            timestamp: Date.now()
        });
        
        switch (signal.type) {
            case 'emotional':
                return {
                    mode: MODES.LISTENING,
                    message: this.mirrorEmotion(userInput),
                    question: this.askOneClarifyingQuestion(userInput),
                    actions: []
                };
                
            case 'explanatory':
                return {
                    mode: MODES.CLARIFYING,
                    message: this.reflectMeaning(userInput),
                    question: this.narrowChoices(userInput),
                    actions: []
                };
                
            case 'overwhelmed':
                return {
                    mode: MODES.PAUSED,
                    message: this.gentleReassurance(),
                    actions: ['Pause', 'Come back later']
                };
                
            case 'request_to_shrink':
                return {
                    mode: MODES.SHRINKING,
                    message: this.permissionBasedTransition(),
                    actions: ['Make this smaller']
                };
                
            case 'ready_for_action':
                // Only show action buttons if user has explicitly indicated readiness
                // User indicates readiness by:
                // 1. Going through clarification/shrinking modes first, OR
                // 2. Directly asking for help with an assignment (action-oriented input)
                const hasIndicatedReadiness = context.currentMode === MODES.CLARIFYING || 
                                             context.currentMode === MODES.SHRINKING ||
                                             this.conversationContext.length > 1 ||
                                             // Direct assignment request indicates readiness
                                             (this.conversationContext.length === 1 && 
                                              signal.input && 
                                              this.isDirectAssignmentRequest(signal.input));
                
                return {
                    mode: MODES.STEPPING,
                    message: this.presentNextTinyStep(context),
                    actions: hasIndicatedReadiness ? ['Start this step', 'Make it smaller'] : []
                };
                
            default:
                // Fallback to emotional
                return {
                    mode: MODES.LISTENING,
                    message: this.mirrorEmotion(userInput),
                    question: this.askOneClarifyingQuestion(userInput),
                    actions: []
                };
        }
    }
    
    // Helper functions for canonical response flow
    
    // Check if input is a direct assignment request (indicates readiness)
    isDirectAssignmentRequest(input) {
        const lowerInput = input.toLowerCase();
        const directRequestPatterns = [
            /help me (write|do|complete|finish)/i,
            /how do i/i,
            /how to/i,
            /show me/i,
            /break down/i,
            /steps/i,
            /guide/i
        ];
        return directRequestPatterns.some(pattern => pattern.test(input));
    }
    
    // Mirror emotion using user's language
    mirrorEmotion(userInput) {
        const lowerInput = userInput.toLowerCase();
        
        if (lowerInput.includes("hate")) {
            return "That sounds really hard.";
        }
        
        if (lowerInput.includes("doesn't feel relevant") || lowerInput.includes("doesnt feel relevant")) {
            return "If something feels pointless, it's way harder to care.";
        }
        
        if (lowerInput.includes("boring") || lowerInput.includes("pointless")) {
            return "When something doesn't feel meaningful, it's hard to engage with it.";
        }
        
        if (lowerInput.includes("difficult") || lowerInput.includes("hard")) {
            return "This feels like a lot right now.";
        }
        
        if (lowerInput.includes("overwhelmed") || lowerInput.includes("too much")) {
            return "This looks like a lot.";
        }
        
        // Default mirror
        return "I hear you.";
    }
    
    // Ask one clarifying question based on input
    askOneClarifyingQuestion(userInput) {
        const lowerInput = userInput.toLowerCase();
        
        if (lowerInput.includes('hate')) {
            return "What about it feels the worst right now?";
        }
        
        if (lowerInput.includes("doesn't feel relevant") || lowerInput.includes("doesnt feel relevant")) {
            return "Is the problem more that it doesn't connect to your life, or you don't see why you're being asked to do it?";
        }
        
        if (lowerInput.includes('boring') || lowerInput.includes('pointless')) {
            return "What's missing that would make it feel meaningful?";
        }
        
        if (lowerInput.includes('difficult') || lowerInput.includes('hard')) {
            return "What part feels the hardest?";
        }
        
        if (lowerInput.includes('overwhelmed') || lowerInput.includes('too much')) {
            return "What feels like too much?";
        }
        
        // Default clarifying question
        return "What's bothering you about this?";
    }
    
    // Reflect meaning of explanatory input
    reflectMeaning(userInput) {
        const lowerInput = userInput.toLowerCase();
        
        if (lowerInput.includes("doesn't feel relevant") || lowerInput.includes("doesnt feel relevant")) {
            return "If something feels pointless, it's way harder to care.";
        }
        
        if (lowerInput.includes("doesn't connect") || lowerInput.includes("doesnt connect")) {
            return "When something doesn't connect to your life, it's hard to see why it matters.";
        }
        
        if (lowerInput.includes("because")) {
            // Extract the reason and reflect it
            return "I hear what you're saying.";
        }
        
        // Default reflection
        return "That makes sense.";
    }
    
    // Narrow choices for explanatory input
    narrowChoices(userInput) {
        const lowerInput = userInput.toLowerCase();
        
        if (lowerInput.includes("doesn't feel relevant") || lowerInput.includes("doesnt feel relevant") ||
            lowerInput.includes("doesn't connect") || lowerInput.includes("doesnt connect")) {
            return "Is the problem more that it doesn't connect to your life, or you don't see why you're being asked to do it?";
        }
        
        if (lowerInput.includes("boring") || lowerInput.includes("pointless")) {
            return "What would need to change for it to feel more engaging?";
        }
        
        // Default narrowing question
        return "Tell me more about that.";
    }
    
    // Gentle reassurance for overwhelmed state (only used when user explicitly signals overwhelm)
    gentleReassurance() {
        // Permission-based statement, no generic reassurance
        return "You can pause whenever you need to.";
    }
    
    // Permission-based transition to shrinking
    permissionBasedTransition() {
        return "Want to keep going, or should we make this into one tiny step?";
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
        
        if (mode === 'listening' || mode === 'clarifying') {
            // No action buttons in listening/clarifying modes
            return [];
        }
        
        if (mode === 'shrinking') {
            // After clarification, offer action
            buttons.push({
                text: 'Want to keep going',
                action: 'continue'
            });
            buttons.push({
                text: 'Make this into one tiny step',
                action: 'shrink'
            });
        }
        
        if (mode === 'stepping') {
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
    createParaphraseMirror(userInput) {
        // Extract key phrases from user input and reflect them back
        // This replaces generic acknowledgements like "Thanks" or "Here's a good place to start"
        const lowerInput = userInput.toLowerCase();
        
        // Look for specific phrases to mirror
        if (lowerInput.includes("doesn't feel relevant") || lowerInput.includes("doesnt feel relevant")) {
            return "If something feels pointless, it's way harder to care.";
        }
        
        if (lowerInput.includes("hate")) {
            return "That sounds really hard.";
        }
        
        if (lowerInput.includes("boring") || lowerInput.includes("pointless")) {
            return "When something doesn't feel meaningful, it's hard to engage with it.";
        }
        
        if (lowerInput.includes("difficult") || lowerInput.includes("hard")) {
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
            
            // Set mode from response
            this.setConversationMode(response.mode);
            
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
        if (response.mode === MODES.LISTENING || response.mode === MODES.CLARIFYING || 
            response.mode === MODES.PAUSED) {
            this.hideMiddleSections();
            if (responseHeader) {
                responseHeader.style.display = 'none';
            }
        } else {
            this.showMiddleSections();
            if (responseHeader) {
                responseHeader.style.display = '';
            }
        }
        
        // Build HTML based on response structure
        let html = '';
        
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
    handleCanonicalAction(action, originalInput) {
        switch(action) {
            case 'pause':
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
                content: `You're dealing with something difficult right now. We don't have to fix this yet.`
            };
        } else if (type === 'compare_contrast') {
            // Remove premature regulation ("take a deep breath"), keep only actionable guidance
            return {
                title: "How to Get Started",
                content: `Start by identifying ONE theme from the book that really stood out to you. Then, think about where you've seen something similar in the news, social media, or your own life. That connection is your starting point - everything else builds from there.`
            };
        } else if (type === 'essay') {
            return {
                title: "How to Get Started",
                content: `Don't try to write the whole paper in your head first! Start by just writing down three things you want to say - they don't have to be perfect, they don't even have to be in order. Just get your thoughts on paper. Once you see them written down, your brain will start connecting the dots.`
            };
        } else {
            return {
                title: "How to Get Started",
                content: `Break the ice by doing the easiest part first. What's the smallest, simplest thing you can do right now? Do that. It gets your brain moving and makes the rest feel less scary.`
            };
        }
    }

    getSteps(assignment, type, includeRegulation = false) {
        if (type === 'resilience_help') {
            return this.getResilienceSteps(assignment, includeRegulation);
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
                description: "Pause for a moment. Take one slow breath. You can pause whenever you need to.",
                needsInput: false
            });
        }
        
        steps.push(
            {
                title: "Name What's Happening",
                description: "What's going on for you right now?",
                needsInput: true,
                inputPrompt: "What's on your mind?",
                inputPlaceholder: "Share what's happening - whatever comes to mind..."
            },
            {
                title: "What Can You Control?",
                description: "What can you actually control here? What can't you control?",
                needsInput: true,
                inputPrompt: "What's in your control vs. what's not?",
                inputPlaceholder: "List what you can control and what you can't..."
            },
            {
                title: "One Small Action",
                description: "What's one tiny thing you could do right now?",
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
                description: "This feeling won't last forever. You've gotten through hard things before.",
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
                description: "Think of themes as the 'main characters' of the book's message. What big ideas kept showing up? For example, if you read about someone fighting for education, that's a theme. Write down 2-3 themes that really stuck with you - don't overthink it, just what felt important.",
                checklist: [
                    "List 2-3 main themes from the book",
                    "For each theme, write one sentence about why it matters",
                    "Pick the theme that interests you most"
                ],
                analogy: "It's like picking your favorite song from an album - you don't need to analyze every song, just the ones that hit you."
            },
            {
                title: "Find Current Connections (The 'Wait, This Sounds Familiar' Step)",
                description: "Now, where have you seen something similar happening? This doesn't have to be a perfect match - think about the CORE idea. If the book talks about fighting for rights, where do you see people fighting for rights today? News articles, social movements, even school policies can work!",
                checklist: [
                    "Brainstorm 3-5 current events or situations that relate to your chosen theme",
                    "For each one, write one sentence about the connection",
                    "Choose 2-3 that have the strongest connections"
                ],
                analogy: "Like when you hear a new song and think 'this reminds me of that other song' - you're finding the musical connection. Same idea, but with themes!"
            },
            {
                title: "Create Your Comparison Framework (The Organizing Step)",
                description: "This is where you decide HOW you'll compare. Will you talk about similarities first, then differences? Or will you go theme by theme? Create a simple structure: 'I'll compare X from the book to Y happening now, focusing on how they're similar in [way] but different in [way].'",
                checklist: [
                    "Decide on your comparison structure (similarities vs differences, or theme-by-theme)",
                    "Write a simple sentence: 'I'm comparing [theme] to [current event]'",
                    "List 2-3 specific points of comparison"
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
                description: "Now that you have your ideas down, make them clearer. Read through and ask: 'Does this make sense? Can someone else understand my point?' Add transitions between paragraphs, fix any confusing parts, and make sure your examples really support your main idea.",
                checklist: [
                    "Read through your draft once for clarity",
                    "Add transition sentences between paragraphs",
                    "Check that each paragraph has a clear point",
                    "Fix any spelling or grammar mistakes",
                    "Read it one more time out loud to catch awkward phrases"
                ],
                analogy: "Like editing a photo - the picture is already there, you're just making the colors pop and cropping out the blurry parts."
            }
        ];
    }

    getEssaySteps(assignment) {
        return [
            {
                title: "Understand What You're Being Asked",
                description: "Read the assignment carefully and identify the key question or prompt. What is the main thing you need to answer or explain?",
                checklist: [
                    "Highlight the main question in the assignment",
                    "Identify any key words (analyze, explain, argue, etc.)",
                    "Write in your own words what you think you need to do"
                ]
            },
            {
                title: "Brainstorm Your Ideas",
                description: "Don't worry about organization yet - just get your thoughts down. What do you know about this topic? What do you think?",
                checklist: [
                    "Write down everything you know about the topic",
                    "List any questions you have",
                    "Note any ideas that pop into your head"
                ]
            },
            {
                title: "Create an Outline",
                description: "Organize your ideas into a simple structure: introduction, main points, conclusion.",
                checklist: [
                    "Write your main argument or thesis",
                    "List 3-5 main points you want to make",
                    "Decide the order that makes the most sense"
                ]
            },
            {
                title: "Write Your First Draft",
                description: "Start writing! Don't worry about perfection - just get your ideas down on paper.",
                checklist: [
                    "Write the introduction",
                    "Write each body paragraph",
                    "Write the conclusion"
                ]
            },
            {
                title: "Revise and Edit",
                description: "Read through your work and make it better. Check for clarity, flow, and correctness.",
                checklist: [
                    "Read through once for content",
                    "Check for clear transitions",
                    "Fix grammar and spelling",
                    "Make sure everything makes sense"
                ]
            }
        ];
    }

    getGeneralSteps(assignment) {
        return [
            {
                title: "Break It Into Smaller Pieces",
                description: "Look at your assignment and identify the main components. What are the different parts you need to complete?",
                checklist: [
                    "List all the parts of the assignment",
                    "Put them in order of what needs to be done first",
                    "Identify which parts seem easiest"
                ]
            },
            {
                title: "Start With the Easiest Part",
                description: "Begin with whatever feels most manageable. Getting started is often the hardest part!",
                checklist: [
                    "Pick the easiest or most interesting part",
                    "Set a timer for 15-20 minutes",
                    "Work on just that one part"
                ]
            },
            {
                title: "Tackle the Rest One at a Time",
                description: "Work through each part systematically. Don't try to do everything at once.",
                checklist: [
                    "Move to the next part",
                    "Complete it before moving on",
                    "Take short breaks between parts"
                ]
            },
            {
                title: "Review and Complete",
                description: "Check your work and make sure everything is done and makes sense.",
                checklist: [
                    "Review each part",
                    "Make sure nothing is missing",
                    "Double-check requirements"
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
        
        // Check if user explicitly signals overwhelm - only then show regulation
        const showsOverwhelm = this.detectsOverwhelmSignal(answer);
        let regulationText = '';
        if (showsOverwhelm) {
            // Only show regulation when user explicitly signals overwhelm
            regulationText = '<p class="regulation-suggestion">Take a breath. You can pause whenever you need to.</p>';
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
            const shouldShowFeedback = mode === 'stepping' || mode === 'shrinking';
            
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
        // Adapt the step based on feedback
        if (action === 'too-much') {
            // Offer alternative phrasing or suggest pause
            const adaptDiv = document.createElement('div');
            adaptDiv.className = 'step-adaptation';
            adaptDiv.innerHTML = `
                <p>Would it help to pause here, or would you like me to rephrase this step differently?</p>
            `;
            stepDiv.appendChild(adaptDiv);
        } else if (action === 'make-smaller') {
            // Break down further
            const adaptDiv = document.createElement('div');
            adaptDiv.className = 'step-adaptation';
            adaptDiv.innerHTML = `
                <p>Let's focus on just one tiny part. What's the smallest piece you could tackle?</p>
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
        
        // Ask "Want to keep going?" after celebration
        setTimeout(() => {
            this.askWantToKeepGoing(currentStepDiv);
        }, 2000);
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

