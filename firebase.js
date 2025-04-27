document.addEventListener('DOMContentLoaded', () => {
    // --- Configuration ---
    const firebaseConfig = {
        apiKey: "AIzaSyBW1WPXUN8DYhT6npZQYoQ3l4J-jFSbzfg", // USE RULES!
        authDomain: "ab-studio-marketcap.firebaseapp.com",
        databaseURL: "https://ab-studio-marketcap-default-rtdb.firebaseio.com",
        projectId: "ab-studio-marketcap",
        // ... other config ...
    };

    // --- Globals ---
    const tg = window.Telegram.WebApp;
    let currentUser = null;
    let userBalances = {}; // Store balances as { 'USD': 100, 'ABT': 50 }
    let availableTokens = {}; // Store token info { 'ABT': { name: 'AB Token', priceUSD: 0.5, logoUrl: '...' } }
    let firebaseApp = null;
    let db = null;
    let userDbRef = null;
    let balanceListenerAttached = false;

    // Swap state
    let swapState = {
        fromToken: null, // symbol e.g., 'USD'
        toToken: null,   // symbol e.g., 'ABT'
        fromAmount: 0,
        toAmount: 0,
        rate: 0,
        isRateLoading: false
    };
    let activeTokenSelector = null; // 'from' or 'to'

    // --- DOM Elements ---
    const loadingOverlay = document.getElementById('loading-overlay');
    const pages = document.querySelectorAll('.page');
    const navButtons = document.querySelectorAll('#bottom-nav .nav-button');
    const backButtons = document.querySelectorAll('.back-button');
    const userInfoDisplay = document.getElementById('user-info-display');
    const totalBalanceDisplay = document.getElementById('total-balance-display');
    const assetListContainer = document.getElementById('asset-list');
    const refreshButton = document.getElementById('refresh-button');

    // Deposit Page
    const depositChatIdSpan = document.getElementById('deposit-chat-id');
    const depositWalletAddressSpan = document.getElementById('deposit-wallet-address'); // Assuming static for demo

    // Withdraw Page
    const withdrawAssetSelect = document.getElementById('withdraw-asset-select');
    const withdrawAvailableBalance = document.getElementById('withdraw-available-balance');
    const withdrawAddressInput = document.getElementById('withdraw-address');
    const withdrawAmountInput = document.getElementById('withdraw-amount');
    const withdrawButton = document.getElementById('withdraw-button');
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
    const executeSwapButton = document.getElementById('execute-swap-button');
    const swapStatus = document.getElementById('swap-status');

    // Token Modal
    const tokenModal = document.getElementById('token-selector-modal');
    const tokenSearchInput = document.getElementById('token-search-input');
    const tokenListModal = document.getElementById('token-list-modal');
    const closeModalButton = tokenModal?.querySelector('.close-modal-button');


    // --- Utility Functions ---
    const formatCurrency = (amount, currency = 'USD') => {
        try {
            // Basic formatting, can be enhanced
            const num = parseFloat(amount) || 0;
            return num.toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: currency === 'USD' ? 2 : 6 // More precision for non-USD
            });
        } catch (e) {
            console.error("Formatting error:", e);
            return "0.00";
        }
    };

    const formatTokenAmount = (amount, decimals = 6) => {
         const num = parseFloat(amount) || 0;
         return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: decimals });
    };

    const sanitizeFloat = (value) => parseFloat(value) || 0;

    // --- Loading & Alerts ---
    function showLoading(message = "Loading...") { /* ... (same as before) ... */ }
    function hideLoading() { /* ... (same as before) ... */ }
    function showTgAlert(message, title = 'Info') { /* ... (same as before) ... */ }
    function handleFirebaseError(error, context = "Firebase operation") { /* ... (enhanced logging maybe) ... */ console.error(`${context} Error:`, error); hideLoading(); showTgAlert(`Error: ${error.message || 'Unknown error'}`, context); }


    // --- Navigation & Page Handling ---
    function showPage(pageId) {
        // ... (Similar to before, reset scroll, update nav buttons) ...
        pages.forEach(page => page.classList.toggle('active', page.id === pageId));
        navButtons.forEach(button => button.classList.toggle('active', button.dataset.page === pageId));
        document.getElementById('main-content').scrollTop = 0;

        // Page specific updates
        if (pageId === 'home-page') updateHomePageUI(); // Refresh home page data
        if (pageId === 'withdraw-page') setupWithdrawPage();
        if (pageId === 'deposit-page') setupDepositPage();
        if (pageId === 'swap-page') setupSwapPage(); // Reset swap state maybe
    }

    // --- Core Data Handling & UI Updates ---

    /** Fetches token definitions from Firebase */
    async function fetchAvailableTokens() {
        if (!db) return;
        try {
            const snapshot = await db.ref('tokens').once('value');
            availableTokens = snapshot.val() || {};
            console.log("Available tokens fetched:", availableTokens);
             populateTokenSelectors(); // Populate swap dropdowns etc.
             updateWithdrawAssetSelector(); // Populate withdraw dropdown
        } catch (error) {
            handleFirebaseError(error, "fetching token list");
        }
    }

     /** Updates the main portfolio display on the Home page */
     function updateHomePageUI() {
         if (!assetListContainer) return;

         let totalValueUSD = 0;
         assetListContainer.innerHTML = ''; // Clear existing list

         const sortedSymbols = Object.keys(userBalances)
            .filter(symbol => userBalances[symbol] > 0.000001) // Filter out negligible balances
            .sort((a, b) => {
                // Sort by USD value, descending. Handle missing token data gracefully.
                const valueA = (userBalances[a] || 0) * (availableTokens[a]?.priceUSD || 0);
                const valueB = (userBalances[b] || 0) * (availableTokens[b]?.priceUSD || 0);
                return valueB - valueA;
            });

         if (sortedSymbols.length === 0) {
             assetListContainer.innerHTML = '<p class="no-assets">You have no assets yet.</p>';
         } else {
             sortedSymbols.forEach(symbol => {
                 const balance = userBalances[symbol] || 0;
                 const tokenInfo = availableTokens[symbol];
                 const priceUSD = tokenInfo?.priceUSD || 0;
                 const valueUSD = balance * priceUSD;
                 totalValueUSD += valueUSD;

                 const card = document.createElement('div');
                 card.className = 'asset-card';
                 card.innerHTML = `
                     <div class="asset-info">
                         <img src="${tokenInfo?.logoUrl || 'placeholder.png'}" alt="${symbol}" class="asset-logo" onerror="this.src='placeholder.png'">
                         <div class="asset-name-symbol">
                             <div class="name">${tokenInfo?.name || symbol}</div>
                             <div class="symbol">${symbol}</div>
                         </div>
                     </div>
                     <div class="asset-balance-value">
                         <div class="balance">${formatTokenAmount(balance)}</div>
                         <div class="value-usd">≈ $${formatCurrency(valueUSD)}</div>
                     </div>
                 `;
                 assetListContainer.appendChild(card);
             });
         }

         if (totalBalanceDisplay) {
             totalBalanceDisplay.textContent = formatCurrency(totalValueUSD);
         }
     }

    /** Displays user profile info */
    function displayUserInfo() {
        // ... (same as before, gets data from `currentUser`) ...
        if (!userInfoDisplay) return;
        if (!currentUser) { userInfoDisplay.innerHTML = '<p style="color: red;">User data unavailable.</p>'; return; }
        const { first_name = '', last_name = '', username = null, id } = currentUser;
        const fullName = `${first_name} ${last_name}`.trim() || 'N/A';
        userInfoDisplay.innerHTML = `
            <p><strong>Name:</strong> <span>${fullName}</span></p>
            <p><strong>Username:</strong> <span>${username ? '@' + username : 'N/A'}</span></p>
            <p><strong>Chat ID:</strong> <span>${id}</span></p>
        `;
    }

    /** Sets up the deposit page UI */
    function setupDepositPage() {
        if (depositChatIdSpan && currentUser) {
            depositChatIdSpan.textContent = currentUser.id;
            // Make sure copy button target is correct
             const copyBtn = depositChatIdSpan.nextElementSibling;
             if (copyBtn) copyBtn.dataset.clipboardText = currentUser.id;
        }
         // In a real app, fetch/generate the actual deposit address for the user/asset
         if (depositWalletAddressSpan) {
             // Keep the placeholder or fetch a real one if implemented
              const demoAddress = "0xAbWalletDemoAddress" + Math.random().toString(16).substring(2, 10); // Example dynamic demo address
              depositWalletAddressSpan.textContent = demoAddress;
               const copyBtn = depositWalletAddressSpan.nextElementSibling;
              if (copyBtn) copyBtn.dataset.clipboardText = demoAddress;
         }
    }

    // --- Firebase Realtime Updates ---
    function setupBalanceListener() {
        if (!userDbRef || balanceListenerAttached) return;

        const balancesRef = userDbRef.child('balances');
        balancesRef.on('value', (snapshot) => {
            userBalances = snapshot.val() || {}; // Update global balance object
            console.log("Realtime balances update:", userBalances);
            updateHomePageUI(); // Refresh asset list and total balance
            updateSwapBalancesUI(); // Update balances shown on swap page
            updateWithdrawPageBalance(); // Update balance on withdraw page if asset selected
        }, (error) => {
            handleFirebaseError(error, "listening to balances");
            balanceListenerAttached = false; // Allow re-attachment attempt
        });

        balanceListenerAttached = true;
        console.log("Balances listener attached.");
    }

    /** Initializes Firebase and User Data */
    async function initializeFirebaseAndUser() {
        showLoading("Connecting & Loading Data...");
        try {
            if (!firebase.apps.length) { firebaseApp = firebase.initializeApp(firebaseConfig); }
            else { firebaseApp = firebase.app(); }
            db = firebase.database();
            console.log("Firebase Initialized");

            await fetchAvailableTokens(); // Load token definitions first

            if (currentUser && currentUser.id) {
                const userId = currentUser.id.toString();
                userDbRef = db.ref('users/' + userId);

                const snapshot = await userDbRef.once('value');
                if (!snapshot.exists()) {
                    console.log(`User ${userId} not found. Creating...`);
                    const newUserProfile = { /* ... profile data ... */ };
                    const initialBalances = { USD: 0 }; // Start with 0 USD balance
                    // Add other default tokens if needed e.g. { USD: 0, ABT: 0 }

                    await userDbRef.set({
                        profile: {
                             telegram_id: currentUser.id,
                             first_name: currentUser.first_name || null,
                             last_name: currentUser.last_name || null,
                             username: currentUser.username || null,
                             createdAt: firebase.database.ServerValue.TIMESTAMP,
                             lastLogin: firebase.database.ServerValue.TIMESTAMP
                        },
                        balances: initialBalances
                    });
                    userBalances = initialBalances; // Set local balances
                    console.log("User created with initial balances.");
                } else {
                    console.log(`User ${userId} found.`);
                    const userData = snapshot.val();
                    userBalances = userData.balances || { USD: 0 }; // Load existing balances or default
                     // Update profile info silently
                     userDbRef.child('profile').update({
                         first_name: currentUser.first_name || userData.profile?.first_name || null,
                         last_name: currentUser.last_name || userData.profile?.last_name || null,
                         username: currentUser.username || userData.profile?.username || null,
                         lastLogin: firebase.database.ServerValue.TIMESTAMP
                     }).catch(err => console.warn("Error updating profile info:", err));
                }
                 setupBalanceListener(); // Attach listener AFTER initial load/create
                 updateHomePageUI(); // Initial UI update
                 hideLoading();

            } else { /* ... handle no user ID error ... */ hideLoading(); disableAppFeatures(); }
        } catch (error) { handleFirebaseError(error, "Initialization"); disableAppFeatures(); }
    }

     function disableAppFeatures() { /* ... disable buttons etc ... */ }


    // --- Swap Functionality ---

     /** Opens the token selection modal */
     function openTokenModal(selectorType) { // selectorType = 'from' or 'to'
         if (!tokenModal) return;
         activeTokenSelector = selectorType;
         populateTokenListModal(); // Populate with current tokens
         tokenSearchInput.value = ''; // Clear search
         tokenModal.style.display = 'flex'; // Show modal
         tokenSearchInput.focus();
     }

      /** Closes the token selection modal */
     function closeTokenModal() {
         if (tokenModal) tokenModal.style.display = 'none';
         activeTokenSelector = null;
     }

     /** Populates the list of tokens in the modal */
     function populateTokenListModal(searchTerm = '') {
         if (!tokenListModal) return;
         tokenListModal.innerHTML = ''; // Clear list
         const lowerSearchTerm = searchTerm.toLowerCase();

         Object.values(availableTokens)
             .filter(token => {
                 // Filter based on search term (name or symbol)
                 return token.name.toLowerCase().includes(lowerSearchTerm) ||
                        token.symbol.toLowerCase().includes(lowerSearchTerm);
             })
              .sort((a,b) => a.name.localeCompare(b.name)) // Sort alphabetically
             .forEach(token => {
                 const li = document.createElement('li');
                 li.dataset.symbol = token.symbol;
                 li.innerHTML = `
                     <img src="${token.logoUrl || 'placeholder.png'}" alt="${token.symbol}" class="token-logo" onerror="this.src='placeholder.png'">
                     <div class="token-details">
                         <div class="name">${token.name}</div>
                         <div class="symbol">${token.symbol}</div>
                     </div>
                 `;
                 li.addEventListener('click', () => handleTokenSelection(token.symbol));
                 tokenListModal.appendChild(li);
             });
     }

     /** Handles selection of a token from the modal */
     function handleTokenSelection(selectedSymbol) {
         if (!activeTokenSelector || !selectedSymbol) return;

          // Prevent selecting the same token for both from and to
         if (activeTokenSelector === 'from' && selectedSymbol === swapState.toToken) {
             // If selecting 'from' token that matches 'to', swap them
             swapState.toToken = swapState.fromToken;
             swapState.fromToken = selectedSymbol;
         } else if (activeTokenSelector === 'to' && selectedSymbol === swapState.fromToken) {
              // If selecting 'to' token that matches 'from', swap them
             swapState.fromToken = swapState.toToken;
             swapState.toToken = selectedSymbol;
         } else {
              // Otherwise, just set the selected token
             swapState[activeTokenSelector === 'from' ? 'fromToken' : 'toToken'] = selectedSymbol;
         }

         updateSwapUI();
         closeTokenModal();
         calculateSwapRate(); // Recalculate after selection
     }

     /** Updates the UI elements on the swap page based on swapState */
     function updateSwapUI() {
         updateTokenButtonUI(swapFromTokenButton, swapState.fromToken);
         updateTokenButtonUI(swapToTokenButton, swapState.toToken);
         updateSwapBalancesUI();

         swapFromAmountInput.value = swapState.fromAmount > 0 ? swapState.fromAmount : '';
         swapToAmountInput.value = swapState.toAmount > 0 ? formatTokenAmount(swapState.toAmount) : ''; // Display formatted 'to' amount

          // Update rate display
         if (swapState.rate > 0 && swapState.fromToken && swapState.toToken) {
              const fromTokenInfo = availableTokens[swapState.fromToken];
              const toTokenInfo = availableTokens[swapState.toToken];
              if (fromTokenInfo && toTokenInfo) {
                 swapRateDisplay.textContent = `1 ${fromTokenInfo.symbol} ≈ ${formatTokenAmount(swapState.rate)} ${toTokenInfo.symbol}`;
                 swapRateDisplay.classList.remove('error');
             } else {
                  swapRateDisplay.textContent = 'Error fetching token data.';
                  swapRateDisplay.classList.add('error');
             }
         } else if (swapState.fromToken && swapState.toToken) {
             swapRateDisplay.textContent = swapState.isRateLoading ? 'Calculating...' : 'Enter amount';
             swapRateDisplay.classList.remove('error');
         } else {
              swapRateDisplay.textContent = 'Select tokens to see rate.';
               swapRateDisplay.classList.remove('error');
         }

         // Enable/Disable Swap button logic
         executeSwapButton.disabled = !(
             swapState.fromToken &&
             swapState.toToken &&
             swapState.fromAmount > 0 &&
             swapState.toAmount > 0 &&
             (userBalances[swapState.fromToken] || 0) >= swapState.fromAmount
         );
     }


     /** Updates a specific token selector button UI */
     function updateTokenButtonUI(buttonElement, tokenSymbol) {
         const tokenInfo = tokenSymbol ? availableTokens[tokenSymbol] : null;
         const logoElement = buttonElement.querySelector('.token-logo');
         const symbolElement = buttonElement.querySelector('.token-symbol');

         if (tokenInfo) {
             logoElement.src = tokenInfo.logoUrl || 'placeholder.png';
             logoElement.alt = tokenInfo.symbol;
             symbolElement.textContent = tokenInfo.symbol;
         } else {
             logoElement.src = 'placeholder.png';
             logoElement.alt = 'Token';
             symbolElement.textContent = 'Select';
         }
     }

     /** Updates the balance displays below the swap input fields */
     function updateSwapBalancesUI() {
         if (swapFromBalance && swapState.fromToken) {
             const balance = userBalances[swapState.fromToken] || 0;
             swapFromBalance.textContent = `Balance: ${formatTokenAmount(balance)}`;
         } else if (swapFromBalance) {
             swapFromBalance.textContent = 'Balance: -';
         }
         if (swapToBalance && swapState.toToken) {
             const balance = userBalances[swapState.toToken] || 0;
             swapToBalance.textContent = `Balance: ${formatTokenAmount(balance)}`;
         } else if (swapToBalance) {
              swapToBalance.textContent = 'Balance: -';
         }
     }

     /** Populates token selectors for swap page (e.g., initial setup) */
     function populateTokenSelectors() {
          // Initial setup - maybe default to USD and the first other token?
         const symbols = Object.keys(availableTokens);
         if (symbols.length >= 1 && !swapState.fromToken) swapState.fromToken = 'USD'; // Default 'From'
         if (symbols.length >= 2 && !swapState.toToken) {
             // Find the first non-USD token to default 'To'
             const defaultTo = symbols.find(s => s !== 'USD') || (symbols.length > 0 ? symbols[0] : null);
             if (defaultTo !== swapState.fromToken) {
                swapState.toToken = defaultTo;
             }
         }
         updateSwapUI();
     }

     /** Calculates the swap rate and estimated output amount */
     function calculateSwapRate() {
         const { fromToken, toToken, fromAmount } = swapState;
         if (!fromToken || !toToken) {
             swapState.rate = 0;
             swapState.toAmount = 0;
             updateSwapUI();
             return;
         }

         const fromTokenInfo = availableTokens[fromToken];
         const toTokenInfo = availableTokens[toToken];

         if (!fromTokenInfo || !toTokenInfo || !fromTokenInfo.priceUSD || !toTokenInfo.priceUSD || toTokenInfo.priceUSD <= 0) {
             console.error("Missing token price data for rate calculation.", fromToken, toToken);
             swapRateDisplay.textContent = 'Error: Cannot calculate rate.';
             swapRateDisplay.classList.add('error');
             swapState.rate = 0;
             swapState.toAmount = 0;
             updateSwapUI();
             return;
         }

         swapState.isRateLoading = true; // Indicate loading
         updateSwapUI();

         // Simulate slight delay or async fetch if needed in future
         setTimeout(() => {
             swapState.rate = fromTokenInfo.priceUSD / toTokenInfo.priceUSD;
             swapState.toAmount = fromAmount * swapState.rate;
             swapState.isRateLoading = false;
             updateSwapUI(); // Update UI with calculated values
         }, 100); // Simulate tiny delay
     }

     /** Handles changes in the 'From' amount input */
     function handleFromAmountChange() {
         swapState.fromAmount = sanitizeFloat(swapFromAmountInput.value);
         if (swapState.rate > 0) {
             swapState.toAmount = swapState.fromAmount * swapState.rate;
         } else {
             swapState.toAmount = 0;
             // If rate is zero but tokens are selected, try calculating again
             if (swapState.fromToken && swapState.toToken) {
                 calculateSwapRate(); // Trigger rate calc if needed
             }
         }
          updateSwapUI();
     }

     /** Switches the 'from' and 'to' tokens */
     function switchSwapTokens() {
         const tempToken = swapState.fromToken;
         swapState.fromToken = swapState.toToken;
         swapState.toToken = tempToken;

         // Also swap amounts roughly based on inverse rate if possible
         const tempAmount = swapState.fromAmount;
         swapState.fromAmount = swapState.toAmount; // Use the estimated 'to' as the new 'from'
         // Recalculate 'to' amount based on new 'from' amount and new rate
          calculateSwapRate(); // This will update state.toAmount and UI
     }

     /** Executes the swap (Simulated & Insecure) */
     async function executeSwap() {
         if (!userDbRef || !currentUser) { showTgAlert("User or database connection missing.", "Swap Error"); return; }
         if (executeSwapButton.disabled) { console.warn("Swap button clicked while disabled."); return; }

         const { fromToken, toToken, fromAmount, toAmount } = swapState;
         const currentFromBalance = userBalances[fromToken] || 0;

         // Final check
         if (fromAmount <= 0 || toAmount <= 0 || !fromToken || !toToken) {
             showTgAlert("Invalid swap parameters.", "Swap Error");
             return;
         }
         if (currentFromBalance < fromAmount) {
             showTgAlert(`Insufficient ${fromToken} balance.`, "Swap Error");
             return;
         }

         showLoading("Processing Swap...");
         executeSwapButton.disabled = true;
         swapStatus.textContent = 'Processing...';
         swapStatus.className = 'status-message pending';

         const newFromBalance = currentFromBalance - fromAmount;
         const currentToBalance = userBalances[toToken] || 0;
         const newToBalance = currentToBalance + toAmount;

         // ** INSECURE: Direct Client-Side Balance Update **
         // In a REAL app, send this request to a backend for validation & execution.
         const balanceUpdates = {};
         balanceUpdates[`/users/${currentUser.id}/balances/${fromToken}`] = newFromBalance;
         balanceUpdates[`/users/${currentUser.id}/balances/${toToken}`] = newToBalance;

         // Prepare transaction log data
         const txData = {
             type: 'swap',
             fromToken: fromToken,
             fromAmount: fromAmount,
             toToken: toToken,
             toAmount: toAmount,
             rate: swapState.rate,
             timestamp: firebase.database.ServerValue.TIMESTAMP,
             status: 'completed' // Demo only
         };
         const newTxKey = db.ref(`/transactions/${currentUser.id}`).push().key;
         balanceUpdates[`/transactions/${currentUser.id}/${newTxKey}`] = txData;


         try {
             // Use update() for atomic multi-path update
             await db.ref().update(balanceUpdates);

             console.log("Swap successful (simulated).");
             swapStatus.textContent = 'Swap Successful!';
             swapStatus.className = 'status-message success';

             // Reset swap form after a short delay
             setTimeout(() => {
                 swapState.fromAmount = 0;
                 swapState.toAmount = 0;
                 // Optionally reset tokens or keep them for next swap
                 // swapState.fromToken = null;
                 // swapState.toToken = null;
                 updateSwapUI();
                 swapStatus.textContent = ''; // Clear status
             }, 2000);

         } catch (error) {
             handleFirebaseError(error, "executing swap");
             swapStatus.textContent = 'Swap Failed. Please try again.';
             swapStatus.className = 'status-message error';
         } finally {
             hideLoading();
             // Re-enable button maybe after a delay, or let UI update handle it
             // executeSwapButton.disabled = false; // Re-enablement handled by updateSwapUI
         }
     }

     /** Initialize Swap Page listeners and state */
     function setupSwapPage() {
          // Reset amounts, keep tokens?
         swapState.fromAmount = 0;
         swapState.toAmount = 0;
         calculateSwapRate(); // Recalculate rate based on current tokens
         updateSwapUI();
         swapStatus.textContent = ''; // Clear status
     }

    // --- Withdraw Functionality ---

    /** Populates the asset selector on the withdraw page */
    function updateWithdrawAssetSelector() {
         if (!withdrawAssetSelect) return;
         const previousValue = withdrawAssetSelect.value; // Preserve selection if possible
         withdrawAssetSelect.innerHTML = '<option value="">-- Select Asset --</option>'; // Clear existing

         Object.keys(availableTokens)
             .sort((a, b) => a.localeCompare(b)) // Sort symbols alphabetically
             .forEach(symbol => {
                 const tokenInfo = availableTokens[symbol];
                 if (tokenInfo) { // Only add if token info is available
                     const option = document.createElement('option');
                     option.value = symbol;
                     option.textContent = `${tokenInfo.name} (${symbol})`;
                     withdrawAssetSelect.appendChild(option);
                 }
             });

         // Try to restore previous selection
         if (previousValue && withdrawAssetSelect.querySelector(`option[value="${previousValue}"]`)) {
             withdrawAssetSelect.value = previousValue;
         } else {
              withdrawAssetSelect.value = ""; // Reset if previous selection invalid
         }
         updateWithdrawPageBalance(); // Update balance display for selected/reset asset
          withdrawButton.disabled = !withdrawAssetSelect.value; // Disable withdraw if no asset selected
    }

     /** Updates the available balance display on the withdraw page */
     function updateWithdrawPageBalance() {
         if (!withdrawAvailableBalance || !withdrawAssetSelect) return;
         const selectedSymbol = withdrawAssetSelect.value;
         if (selectedSymbol) {
             const balance = userBalances[selectedSymbol] || 0;
             const tokenInfo = availableTokens[selectedSymbol];
             withdrawAvailableBalance.textContent = `${formatTokenAmount(balance)} ${tokenInfo?.symbol || ''}`;
             // Enable/disable max button
             if (withdrawMaxButton) withdrawMaxButton.disabled = balance <= 0;
         } else {
             withdrawAvailableBalance.textContent = '0.00';
             if (withdrawMaxButton) withdrawMaxButton.disabled = true;
         }
         // Validate amount input against new balance
         validateWithdrawAmount();
     }

     /** Validates the withdraw amount against the selected asset's balance */
     function validateWithdrawAmount() {
         const selectedSymbol = withdrawAssetSelect.value;
         const amount = sanitizeFloat(withdrawAmountInput.value);
         const balance = userBalances[selectedSymbol] || 0;
         const address = withdrawAddressInput.value.trim();

         let isValid = true;
         let statusMsg = '';

         if (!selectedSymbol) {
              isValid = false;
             statusMsg = 'Select an asset first.';
         } else if (amount <= 0) {
             isValid = false;
              // Don't show error for 0, just disable button
         } else if (amount > balance) {
             isValid = false;
             statusMsg = 'Amount exceeds available balance.';
             withdrawStatus.className = 'status-message error';
         } else if (!address) {
             isValid = false;
              // Don't show error until button press, just disable
         } else {
             // Basic address check (very rudimentary)
             if (address.length < 10) { // Needs proper validation per crypto type
                 isValid = false;
                 statusMsg = 'Invalid recipient address format.';
                 withdrawStatus.className = 'status-message error';
             }
         }

         withdrawButton.disabled = !isValid;
         if (statusMsg && amount > 0 && address) { // Only show status if trying to input
             withdrawStatus.textContent = statusMsg;
         } else if (!isValid && !withdrawButton.disabled) {
             // Clear status if input becomes invalid but wasn't an explicit error
             withdrawStatus.textContent = '';
             withdrawStatus.className = 'status-message';
         }
     }


    /** Handles the withdrawal process (Simulated & Insecure) */
    async function handleWithdraw() {
         if (!userDbRef || !currentUser) { showTgAlert("User or database connection missing.", "Withdraw Error"); return; }
         if (withdrawButton.disabled) { return; }

         const selectedSymbol = withdrawAssetSelect.value;
         const address = withdrawAddressInput.value.trim();
         const amount = sanitizeFloat(withdrawAmountInput.value);
         const currentBalance = userBalances[selectedSymbol] || 0;

         // Redundant final checks
         if (!selectedSymbol || amount <= 0 || !address || amount > currentBalance) {
             showTgAlert("Invalid withdrawal parameters or insufficient funds.", "Withdraw Error");
              validateWithdrawAmount(); // Re-run validation to show specific error
             return;
         }

         showLoading("Processing Withdrawal...");
         withdrawButton.disabled = true;
         withdrawStatus.textContent = 'Processing...';
         withdrawStatus.className = 'status-message pending';

         const newBalance = currentBalance - amount;

         // ** INSECURE: Direct Client-Side Balance Update **
          const balanceUpdates = {};
          balanceUpdates[`/users/${currentUser.id}/balances/${selectedSymbol}`] = newBalance;

          const txData = {
              type: 'withdraw',
              token: selectedSymbol,
              amount: amount,
              address: address, // BE CAREFUL storing full addresses long-term
              timestamp: firebase.database.ServerValue.TIMESTAMP,
              status: 'completed' // Demo only
          };
          const newTxKey = db.ref(`/transactions/${currentUser.id}`).push().key;
          balanceUpdates[`/transactions/${currentUser.id}/${newTxKey}`] = txData;


         try {
             await db.ref().update(balanceUpdates);
             console.log("Withdrawal successful (simulated).");
             withdrawStatus.textContent = 'Withdrawal Successful!';
             withdrawStatus.className = 'status-message success';
             withdrawAmountInput.value = ''; // Clear amount
             withdrawAddressInput.value = ''; // Clear address
             // Balance display will update via listener
             setTimeout(() => { withdrawStatus.textContent = ''; }, 3000); // Clear status after delay
         } catch (error) {
             handleFirebaseError(error, "executing withdrawal");
             withdrawStatus.textContent = 'Withdrawal Failed. Please try again.';
             withdrawStatus.className = 'status-message error';
         } finally {
             hideLoading();
             // Re-enablement should happen via validation logic
             validateWithdrawAmount();
         }
    }

    /** Sets up the Withdraw page */
    function setupWithdrawPage() {
         updateWithdrawAssetSelector(); // Populate dropdown
         withdrawAmountInput.value = '';
         withdrawAddressInput.value = '';
         withdrawStatus.textContent = '';
         withdrawStatus.className = 'status-message';
         updateWithdrawPageBalance(); // Ensure balance display is correct initially
         validateWithdrawAmount(); // Set initial button state
    }


    // --- Event Listeners ---
    navButtons.forEach(button => button.addEventListener('click', () => showPage(button.dataset.page)));
    backButtons.forEach(button => button.addEventListener('click', () => showPage(button.dataset.target || 'home-page')));
    if(refreshButton) refreshButton.addEventListener('click', initializeFirebaseAndUser); // Re-fetch data

    // Swap Page Listeners
    if(swapFromAmountInput) swapFromAmountInput.addEventListener('input', handleFromAmountChange);
    if(swapSwitchButton) swapSwitchButton.addEventListener('click', switchSwapTokens);
    if(executeSwapButton) executeSwapButton.addEventListener('click', executeSwap);
    if(swapFromTokenButton) swapFromTokenButton.addEventListener('click', () => openTokenModal('from'));
    if(swapToTokenButton) swapToTokenButton.addEventListener('click', () => openTokenModal('to'));

     // Token Modal Listeners
     if (closeModalButton) closeModalButton.addEventListener('click', closeTokenModal);
     if (tokenSearchInput) tokenSearchInput.addEventListener('input', (e) => populateTokenListModal(e.target.value));
     if (tokenModal) tokenModal.addEventListener('click', (e) => { if (e.target === tokenModal) closeTokenModal(); }); // Close on outside click


    // Withdraw Page Listeners
    if (withdrawAssetSelect) withdrawAssetSelect.addEventListener('change', updateWithdrawPageBalance);
    if (withdrawAmountInput) withdrawAmountInput.addEventListener('input', validateWithdrawAmount);
    if (withdrawAddressInput) withdrawAddressInput.addEventListener('input', validateWithdrawAmount);
    if (withdrawMaxButton) withdrawMaxButton.addEventListener('click', () => {
        const selectedSymbol = withdrawAssetSelect.value;
        if (selectedSymbol) {
            withdrawAmountInput.value = userBalances[selectedSymbol] || 0;
             validateWithdrawAmount(); // Re-validate after setting max
        }
    });
    if(withdrawButton) withdrawButton.addEventListener('click', handleWithdraw);


    // --- Initialization ---
    function startApp() {
        console.log("DOM Loaded. Initializing App...");
        tg.ready();
        tg.expand();
        // Apply theme params if needed here

        if (tg.initDataUnsafe && tg.initDataUnsafe.user) {
            currentUser = tg.initDataUnsafe.user;
            displayUserInfo(); // Display user info early
            initializeFirebaseAndUser(); // Start data loading
        } else { /* ... handle no user error ... */ hideLoading(); disableAppFeatures(); }

        showPage('home-page'); // Start on home page
    }

    startApp();

}); // End DOMContentLoaded
