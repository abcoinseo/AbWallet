document.addEventListener('DOMContentLoaded', () => {
    // --- Configuration ---
    const firebaseConfig = {
        apiKey: "AIzaSyBW1WPXUN8DYhT6npZQYoQ3l4J-jFSbzfg", // IMPORTANT: Secure with rules!
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
    let userBalance = 0.0;
    let firebaseApp = null;
    let db = null;
    let userDbRef = null;
    let balanceListenerAttached = false; // Flag to prevent multiple listeners

    // --- DOM Elements ---
    const loadingOverlay = document.getElementById('loading-overlay');
    const pages = document.querySelectorAll('.page');
    const navButtons = document.querySelectorAll('#bottom-nav .nav-button');
    const actionButtons = document.querySelectorAll('.action-btn'); // Quick actions on home
    const backButtons = document.querySelectorAll('.back-button');
    const userInfoDisplay = document.getElementById('user-info-display');
    const balanceDisplay = document.getElementById('balance-display');
    const balanceLastUpdated = document.getElementById('balance-last-updated');
    const withdrawBalanceDisplay = document.getElementById('withdraw-balance');
    const withdrawAddressInput = document.getElementById('withdraw-address');
    const withdrawAmountInput = document.getElementById('withdraw-amount');
    const withdrawButton = document.getElementById('withdraw-button');
    const withdrawMaxButton = document.getElementById('withdraw-max-button');
    const withdrawStatus = document.getElementById('withdraw-status');
    const depositAddressSpan = document.getElementById('deposit-address')?.querySelector('span'); // Get span inside

    // --- Functions ---

    /** Shows the loading overlay */
    function showLoading(message = "Loading...") {
        loadingOverlay.querySelector('p').textContent = message;
        loadingOverlay.classList.add('visible');
    }

    /** Hides the loading overlay */
    function hideLoading() {
        loadingOverlay.classList.remove('visible');
    }

    /**
     * Displays a message using Telegram's alert popup.
     * @param {string} message The message to show.
     * @param {string} [title='Info'] Optional title for the alert.
     */
    function showTgAlert(message, title = 'Info') {
         // Check if tg is available and has showAlert method
        if (tg && typeof tg.showAlert === 'function') {
            tg.showAlert(`${title}: ${message}`);
        } else {
            // Fallback for environments where Telegram WebApp might not be fully available
            alert(`${title}: ${message}`);
            console.warn("Telegram WebApp context not fully available for alert.");
        }
    }


    /**
     * Shows the specified page and hides others. Updates nav button active state.
     * Scrolls the page content to the top.
     * @param {string} pageId The ID of the page to show.
     */
    function showPage(pageId) {
        let pageFound = false;
        pages.forEach(page => {
            if (page.id === pageId) {
                page.classList.add('active');
                pageFound = true;
            } else {
                page.classList.remove('active');
            }
        });

        if (!pageFound) {
            console.error(`Page with ID "${pageId}" not found. Showing home page.`);
            showPage('home-page'); // Default to home if ID is invalid
            return;
        }

        // Update nav button active state
        navButtons.forEach(button => {
            button.classList.toggle('active', button.dataset.page === pageId);
        });

        // Reset scroll position of the main content area
        document.getElementById('main-content').scrollTop = 0;

        // Page-specific setup when shown
        if (pageId === 'withdraw-page') {
            updateWithdrawPageUI();
            withdrawStatus.textContent = ''; // Clear status on page load
            withdrawAddressInput.value = '';
            withdrawAmountInput.value = '';
        } else if (pageId === 'deposit-page') {
             generateAndDisplayDepositAddress(); // Generate a (dummy) address
        }
    }


    /**
     * Updates the main balance display and related UI elements.
     * @param {number} newBalance The new balance amount.
     */
    function updateBalanceDisplay(newBalance) {
        userBalance = parseFloat(newBalance.toFixed(2)); // Ensure 2 decimal places
        const formattedBalance = userBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

        if (balanceDisplay) balanceDisplay.textContent = formattedBalance;
        if (balanceLastUpdated) {
            balanceLastUpdated.textContent = `Last synced: ${new Date().toLocaleTimeString()}`;
             balanceLastUpdated.style.color = 'var(--tg-hint-color)'; // Reset color
        }
        updateWithdrawPageUI(); // Update withdraw page balance too
    }

     /** Updates the UI elements specific to the Withdraw page */
     function updateWithdrawPageUI() {
        if (withdrawBalanceDisplay) {
             const formattedBalance = userBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
             withdrawBalanceDisplay.textContent = `$${formattedBalance}`;
         }
          // Enable/disable max button based on balance
         if (withdrawMaxButton) {
             withdrawMaxButton.disabled = userBalance <= 0;
         }
     }


    /** Displays the fetched Telegram user data on the Home page. */
    function displayUserInfo() {
        if (!userInfoDisplay) return;
        if (!currentUser) {
            userInfoDisplay.innerHTML = '<p style="color: red;">Could not load user data.</p>';
            return;
        }
        // Use 'N/A' or empty string for missing fields
        const firstName = currentUser.first_name || '';
        const lastName = currentUser.last_name || '';
        const username = currentUser.username ? `@${currentUser.username}` : 'N/A';
        const fullName = `${firstName} ${lastName}`.trim();

        userInfoDisplay.innerHTML = `
            <p><strong>Name:</strong> <span>${fullName || 'N/A'}</span></p>
            <p><strong>Username:</strong> <span>${username}</span></p>
            <p><strong>User ID:</strong> <span>${currentUser.id}</span></p>
            <!-- <p><strong>Language:</strong> <span>${currentUser.language_code || 'N/A'}</span></p> -->
        `;
    }


    /** Generates and displays a dummy deposit address */
    function generateAndDisplayDepositAddress() {
         if (!depositAddressSpan) return;
         // Simple pseudo-random "address" for demo purposes
         const dummyAddress = '0x' + [...Array(40)].map(() => Math.floor(Math.random() * 16).toString(16)).join('');
         depositAddressSpan.textContent = dummyAddress;
         // Update the copy button's target data attribute if necessary (though handled by selector usually)
         const copyButton = depositAddressSpan.nextElementSibling;
         if(copyButton && copyButton.classList.contains('copy-button')) {
             copyButton.dataset.clipboardText = dummyAddress; // Ensure ClipboardJS gets the right text
         }
    }


    /** Handles common Firebase errors */
    function handleFirebaseError(error, context = "Firebase operation") {
        console.error(`${context} Error:`, error);
        hideLoading(); // Ensure loading is hidden on error
         let message = `Error during ${context}. Code: ${error.code || 'N/A'}. Message: ${error.message || 'Unknown error'}`;
         // Provide more user-friendly messages for common issues if possible
         if (error.code === 'PERMISSION_DENIED') {
             message = "Error: You don't have permission for this action. Please check Firebase rules or contact support.";
         } else if (error.message?.includes('network error')) {
              message = "Network error. Please check your connection and try again.";
         }
        showTgAlert(message, "Database Error");
         // Update UI to reflect error state if needed
         if (balanceLastUpdated) {
            balanceLastUpdated.textContent = `Sync failed`;
            balanceLastUpdated.style.color = 'red';
         }
    }


    /** Initializes Firebase and loads/creates user data */
    function initializeFirebaseAndUser() {
        try {
            if (!firebase.apps.length) {
                firebaseApp = firebase.initializeApp(firebaseConfig);
            } else {
                firebaseApp = firebase.app();
            }
            db = firebase.database();
            console.log("Firebase Initialized");

            if (currentUser && currentUser.id) {
                const userId = currentUser.id.toString();
                userDbRef = db.ref('users/' + userId);

                // Check if user exists, create if not, then listen for balance
                userDbRef.once('value')
                    .then((snapshot) => {
                        if (!snapshot.exists()) {
                            console.log(`User ${userId} not found. Creating...`);
                            const newUser = {
                                telegram_id: currentUser.id,
                                first_name: currentUser.first_name || null,
                                last_name: currentUser.last_name || null,
                                username: currentUser.username || null,
                                balance: 0.00, // Initial balance
                                created_at: firebase.database.ServerValue.TIMESTAMP,
                                last_login: firebase.database.ServerValue.TIMESTAMP
                            };
                            return userDbRef.set(newUser).then(() => {
                                console.log("User created successfully with balance 0");
                                updateBalanceDisplay(0.00);
                                setupBalanceListener(); // Start listening after creation
                                hideLoading();
                            });
                        } else {
                            console.log(`User ${userId} found.`);
                            const userData = snapshot.val();
                            // Update non-critical info like name/username and last login timestamp
                            const updates = {
                                first_name: currentUser.first_name || userData.first_name || null,
                                last_name: currentUser.last_name || userData.last_name || null,
                                username: currentUser.username || userData.username || null,
                                last_login: firebase.database.ServerValue.TIMESTAMP
                            };
                            return userDbRef.update(updates).then(() => {
                                // Initial balance load & setup listener
                                updateBalanceDisplay(userData.balance || 0.00);
                                setupBalanceListener();
                                hideLoading();
                             });
                        }
                    })
                    .catch(error => handleFirebaseError(error, "fetching/creating user data"));

            } else {
                console.error("No user ID found to initialize Firebase path.");
                showTgAlert("Could not identify user for database operations.", "Initialization Error");
                hideLoading();
                // Disable sensitive features if user ID is missing
                 disableAppFeatures();
            }

        } catch (error) {
            handleFirebaseError(error, "Firebase initialization");
             disableAppFeatures();
        }
    }

    /** Disables core app functionality if initialization fails */
    function disableAppFeatures() {
         navButtons.forEach(b => b.disabled = true);
         actionButtons.forEach(b => b.disabled = true);
         if(withdrawButton) withdrawButton.disabled = true;
         // Keep home button potentially active but show error
         navButtons[0].disabled = false;
         showPage('home-page');
         userInfoDisplay.innerHTML = '<p style="color: red;">Wallet initialization failed. Functionality limited.</p>';
         balanceDisplay.textContent = 'N/A';
    }


    /** Sets up the real-time listener for balance changes in Firebase. */
    function setupBalanceListener() {
        if (!userDbRef || balanceListenerAttached) {
             if(balanceListenerAttached) console.log("Balance listener already attached.");
            return; // Don't attach multiple listeners
        }

        const balanceRef = userDbRef.child('balance');

        balanceRef.on('value', (snapshot) => {
            const newBalance = snapshot.val() ?? 0.00; // Use nullish coalescing for default
            console.log("Realtime balance update:", newBalance);
            updateBalanceDisplay(parseFloat(newBalance)); // Ensure it's a number
        }, (error) => {
            handleFirebaseError(error, "listening to balance changes");
            // Attempt to re-attach listener might be needed here in a robust app
            balanceListenerAttached = false; // Allow re-attachment attempt
        });

        balanceListenerAttached = true;
        console.log("Balance listener attached.");
    }

    /**
     * Handles the withdrawal process (DEMO - INSECURE).
     * **WARNING: Server-side validation is REQUIRED for a real application.**
     */
    async function handleWithdraw() {
        if (!userDbRef || !currentUser) {
             showTgAlert("Cannot perform withdrawal. User or database connection missing.", "Error");
             return;
        }

        const address = withdrawAddressInput.value.trim();
        const amountStr = withdrawAmountInput.value.trim();
        const amount = parseFloat(amountStr);

        // --- Client-Side Validation (Basic) ---
        withdrawStatus.textContent = ''; // Clear previous status
        withdrawStatus.className = 'status-message'; // Reset class

        if (!address) {
            withdrawStatus.textContent = 'Please enter a recipient address.';
            withdrawStatus.classList.add('error');
            return;
        }
         // Basic check - real validation is much more complex per-currency
        if (address.length < 10) { // Very rudimentary check
            withdrawStatus.textContent = 'Please enter a valid address.';
            withdrawStatus.classList.add('error');
            return;
        }
        if (isNaN(amount) || amount <= 0) {
            withdrawStatus.textContent = 'Please enter a valid positive amount.';
            withdrawStatus.classList.add('error');
            return;
        }
        if (amount > userBalance) {
            withdrawStatus.textContent = 'Insufficient balance for this withdrawal.';
            withdrawStatus.classList.add('error');
            return;
        }
        // --- End Validation ---

        // --- SIMULATED Client-Side Update (INSECURE DEMO) ---
        showLoading("Processing Withdrawal..."); // Use loading overlay
        withdrawButton.disabled = true;
        withdrawStatus.textContent = 'Processing...';
        withdrawStatus.classList.add('pending');


        const newBalance = parseFloat((userBalance - amount).toFixed(2)); // Calculate with precision

        try {
            // **CRITICAL FLAW:** Updating balance directly from client.
            // In a real app: Send request (address, amount, userId/token) to your backend.
            // Backend validates -> processes transaction -> updates DB.

            // Update balance in Firebase
            await userDbRef.child('balance').set(newBalance);

             // Add a transaction record (Good practice, but still part of insecure flow here)
             const transactionRef = db.ref('transactions/' + currentUser.id.toString()).push();
             await transactionRef.set({
                 type: 'withdraw',
                 amount: amount,
                 address: address, // In real app, maybe just store hash or partial address client-side
                 currency: 'USD', // Assuming USD for now
                 timestamp: firebase.database.ServerValue.TIMESTAMP,
                 status: 'completed' // **DEMO ONLY**: Real status would update after backend processing
             });

            console.log(`Withdrawal processed (client-side simulation). New balance: ${newBalance}`);
            // Real-time listener should update the UI automatically.
            withdrawStatus.textContent = 'Withdrawal successful!';
            withdrawStatus.classList.remove('pending');
            withdrawStatus.classList.add('success');

            // Clear inputs after success
            withdrawAddressInput.value = '';
            withdrawAmountInput.value = '';
            hideLoading();

        } catch (error) {
            handleFirebaseError(error, "processing withdrawal");
             withdrawStatus.textContent = 'Withdrawal failed. Please try again.';
             withdrawStatus.classList.remove('pending');
             withdrawStatus.classList.add('error');
             // **Important:** If the DB write fails, the UI might be out of sync.
             // A robust app would handle this better, maybe forcing a re-fetch or revert.
             hideLoading();
        } finally {
             withdrawButton.disabled = false; // Re-enable button
        }
    }

    // --- Event Listeners ---

    // Navigation Button Clicks
    navButtons.forEach(button => {
        button.addEventListener('click', () => {
            if (!button.classList.contains('active')) { // Only act if not already active
                 const pageId = button.dataset.page;
                 showPage(pageId);
            }
        });
    });

    // Quick Action Button Clicks (on Home page)
     actionButtons.forEach(button => {
         button.addEventListener('click', () => {
             const pageId = button.dataset.page;
             showPage(pageId);
         });
     });

     // Back Button Clicks
     backButtons.forEach(button => {
         button.addEventListener('click', () => {
             const targetPageId = button.dataset.target || 'home-page'; // Default to home
             showPage(targetPageId);
         });
     });


     // Withdraw Button Click
     if (withdrawButton) {
         withdrawButton.addEventListener('click', handleWithdraw);
     }

     // Withdraw Max Button Click
     if (withdrawMaxButton) {
         withdrawMaxButton.addEventListener('click', () => {
             if (withdrawAmountInput && userBalance > 0) {
                 // Set amount, maybe leave tiny bit for fees if applicable in real scenario
                 withdrawAmountInput.value = userBalance.toFixed(2);
             }
         });
     }


    // --- Initialization ---
    function startApp() {
        console.log("DOM Loaded. Initializing App...");
        showLoading("Connecting...");
        tg.ready(); // Inform Telegram the app is ready

        // Expand the Web App to full height
        tg.expand();

        // Apply theme parameters (basic example)
         document.body.style.setProperty('--tg-bg-color', tg.themeParams.bg_color || '#ffffff');
         document.body.style.setProperty('--tg-text-color', tg.themeParams.text_color || '#000000');
         // ... apply other theme variables to :root if needed ...

        // Get user data (use unsafe for display, validate on backend for actions)
        // **SECURITY NOTE:** initData should be validated on a backend for secure operations.
        if (tg.initDataUnsafe && tg.initDataUnsafe.user) {
            currentUser = tg.initDataUnsafe.user;
            console.log("Telegram User Data:", currentUser);
            displayUserInfo();
            initializeFirebaseAndUser(); // Initialize Firebase after getting user data
        } else {
            console.error("Could not retrieve Telegram user data.");
            showTgAlert("Could not load user information. Wallet functionality may be limited.", "Initialization Error");
             userInfoDisplay.innerHTML = '<p style="color: red;">Error: Telegram user data unavailable. Ensure you are running this inside Telegram.</p>';
            hideLoading();
            disableAppFeatures();
        }

        // Initial page setup (should be handled by showPage now)
         // showPage('home-page'); // Ensure home is shown initially if no other logic dictates otherwise
    }

    startApp(); // Start the application logic

}); // End DOMContentLoaded
