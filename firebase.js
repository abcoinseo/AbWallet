document.addEventListener('DOMContentLoaded', () => {
    // --- Configuration ---
    // IMPORTANT: REPLACE WITH YOUR ACTUAL CONFIG
    // ENSURE YOU HAVE SET UP FIREBASE AND ENABLED REALTIME DATABASE
    const firebaseConfig = {
        apiKey: "AIzaSyBW1WPXUN8DYhT6npZQYoQ3l4J-jFSbzfg", // USE RULES & SECURE YOUR KEYS!
        authDomain: "ab-studio-marketcap.firebaseapp.com",
        databaseURL: "https://ab-studio-marketcap-default-rtdb.firebaseio.com",
        projectId: "ab-studio-marketcap",
        storageBucket: "ab-studio-marketcap.firebasestorage.app",
        messagingSenderId: "115268088088",
        appId: "1:115268088088:web:65643a047f92bfaa66ee6d"
    };

    // --- Globals ---
    const tg = window.Telegram.WebApp;
    let currentUser = null;
    let userBalances = {};
    let availableTokens = {};
    let firebaseApp = null;
    let db = null;
    let userDbRef = null;
    let balanceListenerAttached = false;
    const SWAP_FEE_PERCENT = 0.1; // 0.1% swap fee
    let rateCalculationTimeout = null; // For debouncing rate calculation

    // Swap state
    let swapState = { fromToken: null, toToken: null, fromAmount: 0, toAmount: 0, rate: 0, isRateLoading: false };
    let activeTokenSelector = null; // 'from' or 'to'

    // --- DOM Elements ---
    const loadingOverlay = document.getElementById('loading-overlay');
    const pages = document.querySelectorAll('.page');
    const navButtons = document.querySelectorAll('#bottom-nav .nav-button');
    const backButtons = document.querySelectorAll('.back-button');
    const refreshButton = document.getElementById('refresh-button');
    // Home
    const userInfoDisplay = document.getElementById('user-info-display');
    const totalBalanceDisplay = document.getElementById('total-balance-display');
    const assetListContainer = document.getElementById('asset-list');
    // Receive (Deposit) Page
    const depositChatIdSpan = document.getElementById('deposit-chat-id');
    // Send (Withdraw) Page
    const withdrawAssetSelect = document.getElementById('withdraw-asset-select');
    const withdrawAvailableBalance = document.getElementById('withdraw-available-balance');
    const withdrawRecipientIdInput = document.getElementById('withdraw-recipient-id');
    const withdrawAmountInput = document.getElementById('withdraw-amount');
    const sendButton = document.getElementById('send-button');
    const withdrawMaxButton = document.getElementById('withdraw-max-button');
    const withdrawStatus = document.getElementById('withdraw-status');
    // Swap Page
    const swapFromAmountInput = document.getElementById('swap-from-amount');
    const swapToAmountInput = document.getElementById('swap-to-amount');
    const swapFromTokenButton = document.getElementById('swap-from-token-button');
    const swapToTokenButton = document.getElementById('swap-to-token-button');
    const swapFromBalance = document.getElementById('swap-from-balance');
    const swapToBalance = document.getElementById('swap-to-balance');
    const swapSwitchButton = document.getElementById('swap-switch-button');
    const swapRateDisplay = document.getElementById('swap-rate-display');
    const swapFeeDisplay = document.getElementById('swap-fee-info'); // Fee display element
    const executeSwapButton = document.getElementById('execute-swap-button');
    const swapStatus = document.getElementById('swap-status');
    // Token Modal
    const tokenModal = document.getElementById('token-selector-modal');
    const tokenSearchInput = document.getElementById('token-search-input');
    const tokenListModal = document.getElementById('token-list-modal');
    const closeModalButton = tokenModal?.querySelector('.close-modal-button');


    // --- Utility Functions ---
    const formatCurrency = (amount) => {
        const num = parseFloat(amount) || 0;
        return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };
    const formatTokenAmount = (amount, decimals = 6) => {
         const num = parseFloat(amount) || 0;
         // Adjust precision based on value if needed, e.g., show more decimals for very small amounts
         const maxDecimals = (num > 0 && num < 0.01) ? 8 : decimals;
         return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: maxDecimals });
    };
    const sanitizeFloat = (value) => parseFloat(String(value).replace(/[^0-9.]/g, '')) || 0; // Allow only numbers and dot
    const sanitizeInt = (value) => parseInt(value, 10) || 0;


    // --- Loading & Alerts ---
    function showLoading(message = "Loading...") {
        if(!loadingOverlay) return;
        loadingOverlay.querySelector('p').textContent = message;
        loadingOverlay.classList.add('visible');
        console.log(`Showing loading: ${message}`); // Debug
    }
    function hideLoading() {
        if(loadingOverlay) loadingOverlay.classList.remove('visible');
        console.log("Hiding loading"); // Debug
    }
    function showTgAlert(message, title = 'Info') {
        if (tg && typeof tg.showAlert === 'function') {
            tg.showAlert(`${title}: ${message}`);
        } else {
            alert(`${title}: ${message}`); // Fallback
        }
        console.log(`Alert: ${title} - ${message}`); // Debug
    }
    function handleFirebaseError(error, context = "Firebase operation") {
        console.error(`${context} Error:`, error.code, error.message);
        hideLoading(); // Ensure loading is hidden on error
        let userMessage = `An error occurred (${context}). Please try again.`;
        if (error.code === 'PERMISSION_DENIED') {
             userMessage = "Error: Permission denied. Please check app configuration or contact support.";
         } else if (error.message?.includes('network error') || error.code === 'unavailable') {
              userMessage = "Network error. Please check your connection and try again.";
         }
        showTgAlert(userMessage, "Error");
    }


    // --- Navigation & Page Handling ---
    function showPage(pageId) {
        // ... (Logic to add/remove 'active' class from pages) ...
        pages.forEach(page => page.classList.toggle('active', page.id === pageId));
        navButtons.forEach(button => button.classList.toggle('active', button.dataset.page === pageId));
        document.getElementById('main-content').scrollTop = 0;

        // Page specific setup/reset
        console.log(`Navigating to page: ${pageId}`); // Debug
        if (pageId === 'home-page') updateHomePageUI();
        if (pageId === 'withdraw-page') setupSendPage();
        if (pageId === 'deposit-page') setupReceivePage();
        if (pageId === 'swap-page') setupSwapPage();
    }


    // --- Core Data Handling & UI Updates ---
    async function fetchAvailableTokens() {
        if (!db) { console.error("DB not initialized for fetchAvailableTokens"); return; }
        console.log("Fetching available tokens..."); // Debug
        try {
            const snapshot = await db.ref('tokens').once('value');
            availableTokens = snapshot.val() || {};
            if (Object.keys(availableTokens).length === 0) {
                console.warn("No tokens found in Firebase '/tokens' path.");
                 showTgAlert("Token data could not be loaded. Swapping may be unavailable.", "Configuration Error");
            } else {
                console.log("Available tokens fetched:", Object.keys(availableTokens));
                 // Ensure selectors are populated *after* tokens are loaded
                 populateTokenSelectors();
                 updateWithdrawAssetSelector();
            }
        } catch (error) {
            handleFirebaseError(error, "fetching token list");
             availableTokens = {}; // Reset on error
        }
    }

     function updateHomePageUI() {
        console.log("Updating Home Page UI"); // Debug
         if (!assetListContainer || !totalBalanceDisplay) return;
         // ... (Asset list generation and total balance calculation - same logic as before) ...
         // Ensure placeholder text is removed if assets load
         const assetCards = assetListContainer.querySelectorAll('.asset-card');
         if(assetCards.length > 0) {
             const placeholder = assetListContainer.querySelector('.placeholder-text');
             if(placeholder) placeholder.remove();
         } else if (!assetListContainer.querySelector('.no-assets') && !assetListContainer.querySelector('.placeholder-text')) {
             assetListContainer.innerHTML = '<p class="no-assets placeholder-text">You have no assets yet.</p>';
         }
         // Update total balance display
         // ... calculation logic ...
         // totalBalanceDisplay.textContent = formatCurrency(totalValueUSD);
     }

    function displayUserInfo() {
        console.log("Displaying User Info"); // Debug
        if (!userInfoDisplay || !currentUser) {
            if (userInfoDisplay) userInfoDisplay.textContent = 'User data unavailable.';
            return;
        }
        // ... (Generate HTML for user info - same logic as before) ...
    }

    function setupReceivePage() {
        console.log("Setting up Receive Page"); // Debug
        if (depositChatIdSpan && currentUser) {
            depositChatIdSpan.textContent = currentUser.id;
            depositChatIdSpan.classList.remove('placeholder-text');
            const copyBtn = depositChatIdSpan.closest('.deposit-info-card')?.querySelector('.copy-button');
            if (copyBtn) copyBtn.dataset.clipboardText = currentUser.id;
        } else if (depositChatIdSpan) {
            depositChatIdSpan.textContent = 'N/A';
             depositChatIdSpan.classList.add('placeholder-text');
        }
    }


    // --- Firebase Realtime Updates ---
    function setupBalanceListener() {
        if (!userDbRef || balanceListenerAttached) return;
        console.log("Setting up balance listener for user:", currentUser?.id); // Debug
        const balancesRef = userDbRef.child('balances');
        balancesRef.on('value', (snapshot) => {
            userBalances = snapshot.val() || {};
            console.log("Realtime balances update received:", userBalances); // Debug
            // Update UI only if the relevant page is active
            if (document.getElementById('home-page')?.classList.contains('active')) updateHomePageUI();
            if (document.getElementById('swap-page')?.classList.contains('active')) {
                updateSwapBalancesUI();
                validateSwapInput();
            }
            if (document.getElementById('withdraw-page')?.classList.contains('active')) {
                updateWithdrawPageBalance();
            }
        }, (error) => {
            handleFirebaseError(error, "listening to balances");
            balanceListenerAttached = false; // Allow re-attachment attempt
        });
        balanceListenerAttached = true;
    }


    // --- Initialization ---
    async function initializeFirebaseAndUser() {
        showLoading("Connecting & Loading Data...");
        try {
            if (!firebase.apps.length) { firebaseApp = firebase.initializeApp(firebaseConfig); }
            else { firebaseApp = firebase.app(); }
            db = firebase.database();
            console.log("Firebase Initialized");

            // Fetch tokens FIRST - essential for portfolio display and swap setup
            await fetchAvailableTokens();

            if (!currentUser || !currentUser.id) { throw new Error("User data not available."); }
            console.log("Initializing data for user:", currentUser.id); // Debug

            const userId = currentUser.id.toString();
            userDbRef = db.ref('users/' + userId);

            const snapshot = await userDbRef.once('value');
            if (!snapshot.exists()) {
                console.log(`User ${userId} not found. Creating...`); // Debug
                const initialBalances = { USD: 0 }; // Default balance
                 // Add other tokens from availableTokens with 0 balance if needed
                 // Object.keys(availableTokens).forEach(symbol => {
                 //     if (symbol !== 'USD' && !initialBalances.hasOwnProperty(symbol)) {
                 //         initialBalances[symbol] = 0;
                 //     }
                 // });
                await userDbRef.set({
                    profile: { /* ... profile data, ensure timestamps are set ... */
                        telegram_id: currentUser.id,
                        first_name: currentUser.first_name || null,
                        last_name: currentUser.last_name || null,
                        username: currentUser.username || null,
                        createdAt: firebase.database.ServerValue.TIMESTAMP,
                        lastLogin: firebase.database.ServerValue.TIMESTAMP
                    },
                    balances: initialBalances
                });
                userBalances = initialBalances;
                console.log("User created."); // Debug
            } else {
                console.log(`User ${userId} found.`); // Debug
                const userData = snapshot.val();
                userBalances = userData.balances || { USD: 0 };
                 // Update profile info silently
                 userDbRef.child('profile').update({
                     first_name: currentUser.first_name || userData.profile?.first_name || null,
                     last_name: currentUser.last_name || userData.profile?.last_name || null,
                     username: currentUser.username || userData.profile?.username || null,
                     lastLogin: firebase.database.ServerValue.TIMESTAMP
                 }).catch(err => console.warn("Non-critical error updating profile info:", err));
            }

            setupBalanceListener(); // Attach listener AFTER initial data load/create
            updateHomePageUI(); // Update home page with initial data
            // Don't hide loading here if listener might trigger fast updates causing flicker
            // Hide loading after a slight delay or after first listener callback? For now, hide directly.
            hideLoading();

        } catch (error) {
            handleFirebaseError(error, "Initialization");
            disableAppFeatures(); // Disable features if init fails critically
        }
    }

    function disableAppFeatures() {
        console.error("Disabling app features due to critical initialization error."); // Debug
        navButtons.forEach(b => b.disabled = true);
        // Show a persistent error message to the user?
         showTgAlert("Wallet could not be initialized. Please try again later.", "Fatal Error");
         hideLoading(); // Ensure loading is hidden even on error
    }


    // --- Swap Functionality (with Fee) ---
    function openTokenModal(selectorType) {
         if (!tokenModal) return;
         console.log(`Opening token modal for: ${selectorType}`); // Debug
         activeTokenSelector = selectorType;
         populateTokenListModal(); // Re-populate fresh list
         tokenSearchInput.value = ''; // Clear search
         tokenModal.style.display = 'flex';
         requestAnimationFrame(() => { // Ensure display:flex is applied before focusing
             tokenSearchInput.focus();
         });
     }
    function closeTokenModal() {
        if (tokenModal) tokenModal.style.display = 'none';
        activeTokenSelector = null;
        console.log("Token modal closed"); // Debug
    }
    function populateTokenListModal(searchTerm = '') {
        if (!tokenListModal) return;
        tokenListModal.innerHTML = ''; // Clear list
        const lowerSearchTerm = searchTerm.toLowerCase().trim();

        const filteredTokens = Object.values(availableTokens).filter(token =>
             token.name.toLowerCase().includes(lowerSearchTerm) ||
             token.symbol.toLowerCase().includes(lowerSearchTerm)
        );

        if(filteredTokens.length === 0) {
            tokenListModal.innerHTML = '<li class="placeholder-text">No tokens found.</li>';
            return;
        }

        filteredTokens
             .sort((a,b) => a.name.localeCompare(b.name)) // Sort alphabetically
             .forEach(token => {
                 const li = document.createElement('li');
                 li.dataset.symbol = token.symbol;
                 li.innerHTML = `
                     <img src="${token.logoUrl || 'placeholder.png'}" alt="${token.symbol}" class="token-logo" onerror="this.src='placeholder.png'; this.onerror=null;">
                     <div class="token-details">
                         <div class="name">${token.name}</div>
                         <div class="symbol">${token.symbol}</div>
                     </div>
                 `;
                 li.addEventListener('click', () => handleTokenSelection(token.symbol));
                 tokenListModal.appendChild(li);
             });
     }
    function handleTokenSelection(selectedSymbol) {
        if (!activeTokenSelector || !selectedSymbol) return;
        console.log(`Token selected: ${selectedSymbol} for ${activeTokenSelector}`); // Debug

        // Prevent selecting the same token & handle swap
        if (activeTokenSelector === 'from' && selectedSymbol === swapState.toToken) { switchSwapTokens(); } // Swap if selecting 'from' matches 'to'
        else if (activeTokenSelector === 'to' && selectedSymbol === swapState.fromToken) { switchSwapTokens(); } // Swap if selecting 'to' matches 'from'
        else { swapState[activeTokenSelector === 'from' ? 'fromToken' : 'toToken'] = selectedSymbol; }

        closeTokenModal();
        requestAnimationFrame(() => { // Ensure UI updates after modal closes
            calculateSwapRate(); // Recalculate rate and amounts
        });
    }
    function updateTokenButtonUI(buttonElement, tokenSymbol) {
         if (!buttonElement) return;
         const tokenInfo = tokenSymbol ? availableTokens[tokenSymbol] : null;
         const logoElement = buttonElement.querySelector('.token-logo');
         const symbolElement = buttonElement.querySelector('.token-symbol');
         if (logoElement && symbolElement) {
             if (tokenInfo) {
                 logoElement.src = tokenInfo.logoUrl || 'placeholder.png';
                 logoElement.alt = tokenInfo.symbol;
                 symbolElement.textContent = tokenInfo.symbol;
             } else {
                 logoElement.src = 'placeholder.png'; logoElement.alt = 'Token'; symbolElement.textContent = 'Select';
             }
         }
     }
    function updateSwapBalancesUI() {
        if (swapFromBalance && swapState.fromToken) {
            swapFromBalance.textContent = `Balance: ${formatTokenAmount(userBalances[swapState.fromToken] || 0, swapState.fromToken === 'USD' ? 2 : 6)}`;
        } else if (swapFromBalance) { swapFromBalance.textContent = 'Balance: -'; }
        if (swapToBalance && swapState.toToken) {
             swapToBalance.textContent = `Balance: ${formatTokenAmount(userBalances[swapState.toToken] || 0, swapState.toToken === 'USD' ? 2 : 6)}`;
        } else if (swapToBalance) { swapToBalance.textContent = 'Balance: -'; }
    }
    function populateTokenSelectors() { // Initial default selection
         const symbols = Object.keys(availableTokens);
         if (symbols.includes('USD') && !swapState.fromToken) swapState.fromToken = 'USD';
         if (!swapState.toToken) {
             const defaultTo = symbols.find(s => s !== swapState.fromToken) || null;
             swapState.toToken = defaultTo;
         }
         console.log("Populated swap selectors, initial state:", swapState); // Debug
         updateSwapUI(); // Update UI with defaults
     }

    /** Debounced calculation to avoid rapid updates while typing */
    function triggerRateCalculation() {
        if (!swapState.fromToken || !swapState.toToken) {
            updateSwapUI(); // Update UI to show 'Select tokens' etc.
            return;
        }
        swapState.isRateLoading = true;
        if (swapRateDisplay) swapRateDisplay.classList.add('loading');
        updateSwapUI(); // Show loading state

        clearTimeout(rateCalculationTimeout);
        rateCalculationTimeout = setTimeout(() => {
            calculateSwapRateInternal();
            swapState.isRateLoading = false;
            if (swapRateDisplay) swapRateDisplay.classList.remove('loading');
            calculateSwapAmounts(); // This calls updateSwapUI
        }, 300); // 300ms debounce
    }

    function calculateSwapRateInternal() { // Renamed internal function
        const { fromToken, toToken } = swapState;
        swapState.rate = 0;
        if (!fromToken || !toToken || !availableTokens[fromToken] || !availableTokens[toToken]) return;

        const fromPrice = availableTokens[fromToken].priceUSD || 0;
        const toPrice = availableTokens[toToken].priceUSD || 0;
        if (fromPrice <= 0 || toPrice <= 0) { console.error("Cannot calc rate, zero price."); return; }

        swapState.rate = fromPrice / toPrice;
        console.log(`Calculated rate: 1 ${fromToken} = ${swapState.rate} ${toToken}`); // Debug
    }

    function calculateSwapAmounts() {
        const { fromToken, toToken, fromAmount, rate } = swapState;
        swapState.toAmount = 0;
        if (!fromToken || !toToken || !fromAmount || fromAmount <= 0 || rate <= 0) {
            updateSwapUI(); return;
        }
        let calculatedToAmount = 0;
        const feeMultiplier = SWAP_FEE_PERCENT / 100;

        // Fee logic (same as before)
        if (fromToken === 'USD') { calculatedToAmount = (fromAmount * (1 - feeMultiplier)) * rate; }
        else if (toToken === 'USD') { calculatedToAmount = (fromAmount * rate) * (1 - feeMultiplier); }
        else { calculatedToAmount = (fromAmount * rate) * (1 - feeMultiplier); }

        swapState.toAmount = calculatedToAmount > 0 ? calculatedToAmount : 0;
        updateSwapUI();
    }

    function handleFromAmountChange() {
        swapState.fromAmount = sanitizeFloat(swapFromAmountInput.value);
        // Rate doesn't change, recalculate 'to' amount and update UI
        calculateSwapAmounts();
    }

    function switchSwapTokens() {
        console.log("Switching swap tokens"); // Debug
        const tempToken = swapState.fromToken;
        swapState.fromToken = swapState.toToken;
        swapState.toToken = tempToken;

        // Attempt a reasonable swap of amounts (optional, can just clear 'from')
        const oldFromAmount = swapState.fromAmount;
        swapState.fromAmount = sanitizeFloat(swapToAmountInput.value); // Use the displayed 'to' amount as new 'from'
        // Clear or recalculate 'to' amount? Recalculate is better.
        triggerRateCalculation(); // This recalculates rate & amounts
    }

    function validateSwapInput() {
         if (!executeSwapButton) return;
         const { fromToken, toToken, fromAmount, toAmount } = swapState;
         const hasSufficientBalance = (userBalances[fromToken] || 0) >= fromAmount;
         const isValid = fromToken && toToken && fromAmount > 0 && toAmount > 0 && hasSufficientBalance;
         executeSwapButton.disabled = !isValid;
         // Provide visual feedback if balance is insufficient maybe?
         if(fromToken && fromAmount > 0 && !hasSufficientBalance) {
            if(swapFromBalance) swapFromBalance.style.color = 'var(--error-color)';
         } else {
             if(swapFromBalance) swapFromBalance.style.color = 'var(--text-secondary)';
         }
    }

    function updateSwapUI() {
        // Update Token Buttons
        updateTokenButtonUI(swapFromTokenButton, swapState.fromToken);
        updateTokenButtonUI(swapToTokenButton, swapState.toToken);
        // Update Balances Display
        updateSwapBalancesUI();
        // Update Amount Inputs
        if (swapFromAmountInput && document.activeElement !== swapFromAmountInput) { // Avoid overwriting while user types
             swapFromAmountInput.value = swapState.fromAmount > 0 ? swapState.fromAmount : '';
         }
        if (swapToAmountInput) {
             swapToAmountInput.value = swapState.toAmount > 0 ? formatTokenAmount(swapState.toAmount, swapState.toToken === 'USD' ? 2 : 6) : '';
         }
        // Update Rate Display
        if (swapRateDisplay) {
             if (swapState.isRateLoading) {
                 swapRateDisplay.textContent = 'Calculating...'; swapRateDisplay.classList.add('loading'); swapRateDisplay.classList.remove('error');
             } else if (swapState.rate > 0 && swapState.fromToken && swapState.toToken) {
                 swapRateDisplay.textContent = `1 ${swapState.fromToken} ≈ ${formatTokenAmount(swapState.rate)} ${swapState.toToken}`;
                 swapRateDisplay.classList.remove('loading', 'error');
             } else if (swapState.fromToken && swapState.toToken) {
                 swapRateDisplay.textContent = 'Enter amount'; swapRateDisplay.classList.remove('loading', 'error'); // Rate calculated but amount is 0
             } else {
                 swapRateDisplay.textContent = 'Select tokens'; swapRateDisplay.classList.remove('loading', 'error');
             }
         }
        // Update Fee Display (static for now)
        if(swapFeeDisplay) swapFeeDisplay.textContent = `Fee: ${SWAP_FEE_PERCENT}%`;

        validateSwapInput(); // Finally check button state
    }

    async function executeSwap() {
        // SECURITY WARNING: This is the insecure client-side execution. Requires Backend.
        if (!userDbRef || !currentUser || !executeSwapButton || executeSwapButton.disabled) return;
        console.log("Executing swap (Client-side simulation - INSECURE)"); // Debug

        const { fromToken, toToken, fromAmount, toAmount } = swapState;
        // Final validation
        if (!fromToken || !toToken || fromAmount <= 0 || toAmount <= 0 || (userBalances[fromToken] || 0) < fromAmount) {
            showTgAlert("Invalid swap details or insufficient balance.", "Swap Error");
            validateSwapInput(); // Re-validate UI
            return;
        }

        showLoading("Processing Swap...");
        executeSwapButton.disabled = true; // Disable button immediately
        swapStatus.textContent = 'Processing...'; swapStatus.className = 'status-message pending';

        const newFromBalance = (userBalances[fromToken] || 0) - fromAmount;
        const newToBalance = (userBalances[toToken] || 0) + toAmount;

        const updates = {};
        const senderId = currentUser.id;
        // Use high precision for storage
        updates[`/users/${senderId}/balances/${fromToken}`] = sanitizeFloat(newFromBalance.toFixed(8));
        updates[`/users/${senderId}/balances/${toToken}`] = sanitizeFloat(newToBalance.toFixed(8));

        const txData = {
            type: 'swap', fromToken, fromAmount, toToken, toAmount,
            rate: swapState.rate, feePercent: SWAP_FEE_PERCENT,
            timestamp: firebase.database.ServerValue.TIMESTAMP, status: 'completed' // Demo only
        };
        const newTxKey = db.ref(`/transactions/${senderId}`).push().key;
        if(newTxKey) updates[`/transactions/${senderId}/${newTxKey}`] = txData;

        try {
            await db.ref().update(updates); // Attempt insecure client-side update
            console.log("Swap successful (simulated)."); // Debug
            swapStatus.textContent = 'Swap Successful!'; swapStatus.className = 'status-message success';
            // Reset form after success
            setTimeout(() => {
                swapState.fromAmount = 0; swapState.toAmount=0;
                updateSwapUI(); // Update UI including button state
                swapStatus.textContent='';
            }, 2000);
        } catch (error) {
            handleFirebaseError(error, "executing swap");
            swapStatus.textContent = 'Swap Failed.'; swapStatus.className = 'status-message error';
            // Button state will be re-evaluated by validateSwapInput after balance listener updates (if it does)
        } finally {
            hideLoading();
            // Do NOT re-enable button here directly, let validation handle it
        }
    }

    function setupSwapPage() {
         console.log("Setting up Swap Page"); // Debug
         // Reset amounts, keep selected tokens, recalculate rate/amounts
         swapState.fromAmount = 0;
         swapState.toAmount = 0;
         triggerRateCalculation(); // Start calculation/update UI
         if(swapStatus) swapStatus.textContent = ''; // Clear status
         updateSwapBalancesUI(); // Ensure balances are shown correctly
    }


    // --- Internal Send Functionality ---
    function updateWithdrawAssetSelector() { /* ... (Same as before) ... */ }
    function updateWithdrawPageBalance() { /* ... (Same as before, calls validateSendInput) ... */ }

    function validateSendInput() {
        if (!sendButton || !withdrawAssetSelect || !withdrawAmountInput || !withdrawRecipientIdInput) return;
        // ... (Validation logic remains the same - check asset, amount, balance, recipient ID format, not sending to self) ...
        let isValid = true; /* ... validation checks ... */
        sendButton.disabled = !isValid;
        // withdrawStatus.textContent = statusMsg; // Display validation errors
    }

    async function handleSend() {
        // SECURITY WARNING: This is the insecure client-side execution. Requires Backend.
        if (!userDbRef || !currentUser || !db || !sendButton || sendButton.disabled) return;
        console.log("Handling send (Client-side simulation - INSECURE)"); // Debug

        const selectedSymbol = withdrawAssetSelect.value;
        const recipientId = sanitizeInt(withdrawRecipientIdInput.value);
        const amount = sanitizeFloat(withdrawAmountInput.value);
        const senderId = currentUser.id;

        // Final validation just before sending
        if (!selectedSymbol || amount <= 0 || !recipientId || recipientId === senderId || (userBalances[selectedSymbol] || 0) < amount) {
             showTgAlert("Invalid send details or insufficient funds.", "Send Error");
             validateSendInput(); return;
         }

        showLoading("Processing Transfer...");
        sendButton.disabled = true;
        withdrawStatus.textContent = 'Verifying recipient...'; withdrawStatus.className = 'status-message pending';

        // ** INSECURE CLIENT-SIDE RECIPIENT CHECK ** Requires Backend
        const recipientRef = db.ref(`users/${recipientId}`);
        let recipientExists = false;
        try {
            const recipientSnapshot = await recipientRef.child('profile').once('value'); // Basic check
            recipientExists = recipientSnapshot.exists();
        } catch (error) { console.error("Error checking recipient:", error); /* Assume doesn't exist or handle error */ }

        if (!recipientExists) {
            hideLoading();
            withdrawStatus.textContent = 'Recipient Chat ID not found.'; withdrawStatus.className = 'status-message error';
            validateSendInput(); // Re-enable button if appropriate
            return;
        }
        // --- End Insecure Check ---

        withdrawStatus.textContent = 'Processing transfer...';

        // ** INSECURE CLIENT-SIDE ATOMIC UPDATE SIMULATION ** Requires Backend with Transactions
        const updates = {};
        const senderBalancePath = `/users/${senderId}/balances/${selectedSymbol}`;
        const recipientBalancePath = `/users/${recipientId}/balances/${selectedSymbol}`;
        let recipientCurrentBalance = 0; // Fetch recipient balance just before update (still risky)
        try {
            const recipBalanceSnapshot = await recipientRef.child(`balances/${selectedSymbol}`).once('value');
            recipientCurrentBalance = sanitizeFloat(recipBalanceSnapshot.val());
        } catch(e){ console.warn("Couldn't read recipient balance reliably", e); }

        const newSenderBalance = (userBalances[selectedSymbol] || 0) - amount;
        const newRecipientBalance = recipientCurrentBalance + amount;

        updates[senderBalancePath] = sanitizeFloat(newSenderBalance.toFixed(8));
        updates[recipientBalancePath] = sanitizeFloat(newRecipientBalance.toFixed(8));

        // Log transaction for both
        const txId = db.ref(`/transactions/${senderId}`).push().key; // Generate unique ID
        const timestamp = firebase.database.ServerValue.TIMESTAMP;
        const senderTx = { type: 'send', token: selectedSymbol, amount, recipientId, timestamp, status: 'completed' };
        const receiverTx = { type: 'receive', token: selectedSymbol, amount, senderId, timestamp, status: 'completed' };
        if(txId) {
            updates[`/transactions/${senderId}/${txId}`] = senderTx;
            updates[`/transactions/${recipientId}/${txId}`] = receiverTx; // Log for receiver too
        }

        try {
            await db.ref().update(updates); // Attempt insecure client-side atomic update
            console.log("Internal transfer successful (simulated)."); // Debug
            withdrawStatus.textContent = 'Funds Sent Successfully!'; withdrawStatus.className = 'status-message success';
            withdrawAmountInput.value = ''; withdrawRecipientIdInput.value = '';
            setTimeout(() => { withdrawStatus.textContent = ''; }, 3000);
        } catch (error) {
            handleFirebaseError(error, "executing internal transfer");
            withdrawStatus.textContent = 'Send Failed.'; withdrawStatus.className = 'status-message error';
        } finally {
            hideLoading();
            // Let balance listener update UI and validation logic re-enable button
        }
    }

    function setupSendPage() {
         console.log("Setting up Send Page"); // Debug
         if(withdrawAssetSelect) updateWithdrawAssetSelector(); // Ensure asset list is current
         if(withdrawAmountInput) withdrawAmountInput.value = '';
         if(withdrawRecipientIdInput) withdrawRecipientIdInput.value = '';
         if(withdrawStatus) { withdrawStatus.textContent = ''; withdrawStatus.className = 'status-message'; }
         updateWithdrawPageBalance(); // Update balance display based on potential default selection
         validateSendInput(); // Set initial button state
    }


    // --- Event Listeners ---
    navButtons.forEach(button => button.addEventListener('click', () => {
        if (!button.classList.contains('active')) showPage(button.dataset.page);
    }));
    backButtons.forEach(button => button.addEventListener('click', () => showPage(button.dataset.target || 'home-page')));
    if(refreshButton) refreshButton.addEventListener('click', initializeFirebaseAndUser);

    // Swap Page
    if(swapFromAmountInput) swapFromAmountInput.addEventListener('input', handleFromAmountChange);
    if(swapSwitchButton) swapSwitchButton.addEventListener('click', switchSwapTokens);
    if(executeSwapButton) executeSwapButton.addEventListener('click', executeSwap);
    if(swapFromTokenButton) swapFromTokenButton.addEventListener('click', () => openTokenModal('from'));
    if(swapToTokenButton) swapToTokenButton.addEventListener('click', () => openTokenModal('to'));

    // Token Modal
    if (closeModalButton) closeModalButton.addEventListener('click', closeTokenModal);
    if (tokenSearchInput) tokenSearchInput.addEventListener('input', (e) => populateTokenListModal(e.target.value));
    if (tokenModal) tokenModal.addEventListener('click', (e) => { if (e.target === tokenModal) closeTokenModal(); });

    // Send Page
    if (withdrawAssetSelect) withdrawAssetSelect.addEventListener('change', updateWithdrawPageBalance);
    if (withdrawAmountInput) withdrawAmountInput.addEventListener('input', validateSendInput);
    if (withdrawRecipientIdInput) withdrawRecipientIdInput.addEventListener('input', validateSendInput);
    if (withdrawMaxButton) withdrawMaxButton.addEventListener('click', () => {
        const selectedSymbol = withdrawAssetSelect?.value;
        if (selectedSymbol && withdrawAmountInput) {
            // Use Math.max to avoid setting negative if balance is somehow negative
            withdrawAmountInput.value = Math.max(0, userBalances[selectedSymbol] || 0);
            validateSendInput();
        }
    });
    if(sendButton) sendButton.addEventListener('click', handleSend);


    // --- Initialization ---
    function startApp() {
        console.log("DOM Loaded. Initializing AB Wallet..."); // Debug
        tg.ready();
        tg.expand();
        tg.setHeaderColor?.(getComputedStyle(document.body).getPropertyValue('--background-elevated').trim()); // Set header color
        tg.setBackgroundColor?.(getComputedStyle(document.body).getPropertyValue('--background-main').trim()); // Set background color

        // Use initDataUnsafe for display only, VALIDATE initData on backend for secure actions
        if (tg.initDataUnsafe && tg.initDataUnsafe.user) {
            currentUser = tg.initDataUnsafe.user;
            console.log("User Data:", currentUser.id, currentUser.username); // Debug
            displayUserInfo(); // Display basic info immediately
            initializeFirebaseAndUser(); // Start full data load
        } else {
            console.error("Could not retrieve Telegram user data."); // Debug
            showTgAlert("Could not load user information. Wallet functionality limited.", "Initialization Error");
            hideLoading();
            disableAppFeatures();
        }
        showPage('home-page'); // Default to home page
    }

    // Add small delay to ensure CSS variables are potentially ready for TG theme setting
    setTimeout(startApp, 50);

}); // End DOMContentLoaded
