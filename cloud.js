const firebaseConfig = {
  apiKey: "AIzaSyDtCybmYjWpoCczFvIGtBgOjBb95_WSnRY",
  authDomain: "icon-studio-simulator.firebaseapp.com",
  projectId: "icon-studio-simulator",
  storageBucket: "icon-studio-simulator.firebasestorage.app",
  messagingSenderId: "804178879068",
  appId: "1:804178879068:web:65b5ad93ce6c2c7d5e3c99"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

const Cloud = {
    uid: null,

    init() {
        auth.onAuthStateChanged(user => {
            if (user) {
                document.getElementById('account-email-display').innerText = user.email || "Google Connected";
                this.uid = user.uid;
                document.getElementById('auth-modal').classList.remove('active-overlay');
                this.checkCloudSave();
            } else {
                this.uid = null;
                document.getElementById('auth-modal').classList.add('active-overlay');
                document.getElementById('os-environment').classList.add('hidden');
            }
        });
        this.bindEvents();
    },

    bindEvents() {
        document.getElementById('btn-google-login').onclick = () => {
            const provider = new firebase.auth.GoogleAuthProvider();
            auth.signInWithPopup(provider).catch(err => this.showError(err.message));
        };

        document.getElementById('btn-login').onclick = () => {
            const email = document.getElementById('auth-email').value;
            const pass = document.getElementById('auth-password').value;
            auth.signInWithEmailAndPassword(email, pass).catch(err => this.showError("Invalid credentials."));
        };

        document.getElementById('btn-signup').onclick = () => {
            const email = document.getElementById('auth-email').value;
            const pass = document.getElementById('auth-password').value;
            if(pass.length < 6) return this.showError("Password too short (min 6 chars).");
            auth.createUserWithEmailAndPassword(email, pass).catch(err => this.showError(err.message));
        };

        const btnLogout = document.getElementById('btn-logout');
        if (btnLogout) {
            btnLogout.onclick = () => {
                auth.signOut().then(() => { location.reload(); });
            };
        }

        const btnCloudSave = document.getElementById('btn-cloud-save');
        if (btnCloudSave) {
            btnCloudSave.onclick = () => {
                if (this.uid && typeof Engine !== 'undefined') Engine.saveGame(false);
            };
        }

        const btnChangePwd = document.getElementById('btn-change-password');
        if (btnChangePwd) {
            btnChangePwd.onclick = () => {
                if (auth.currentUser && auth.currentUser.email) {
                    auth.sendPasswordResetEmail(auth.currentUser.email)
                        .then(() => {
                            if(typeof UI !== 'undefined') UI.showAlert("Email Sent", "A password reset link has been sent to your email.");
                        })
                        .catch(err => {
                            if(typeof UI !== 'undefined') UI.showAlert("Error", err.message);
                        });
                }
            };
        }

        const btnDeleteAcc = document.getElementById('btn-delete-account');
        if (btnDeleteAcc) {
            btnDeleteAcc.onclick = () => {
                if (typeof UI !== 'undefined') {
                    UI.showConfirm("Delete Account", "Are you entirely sure? This will permanently wipe your cloud data and delete your profile.", () => {
                        auth.currentUser.delete().then(() => {
                            localStorage.removeItem('studioOS_save');
                            location.reload();
                        }).catch(err => {
                            UI.showAlert("Security Requirement", "For security reasons, you must log out and log back in right now before you can delete your account.");
                        });
                    });
                }
            };
        }
    },

    showError(msg) {
        const errDiv = document.getElementById('auth-error');
        errDiv.innerText = msg;
        errDiv.classList.remove('hidden');
    },

    async checkCloudSave() {
        try {
            const docRef = db.collection("players").doc(this.uid);
            const doc = await docRef.get();
            
            if (doc.exists && doc.data().saveString) {
                localStorage.setItem('studioOS_save', doc.data().saveString);
                Engine.loadGame(true);
                console.log("Cloud save loaded successfully.");
            } else {
                document.getElementById('onboarding-modal').classList.add('active-overlay');
                console.log("No cloud save found. Initializing new workspace.");
            }
        } catch (error) {
            console.error("Cloud load error:", error);
            this.showError("Failed to sync with Cloud Database.");
        }
    },

    async saveToCloud(saveString) {
        if (!this.uid) return;
        try {
            await db.collection("players").doc(this.uid).set({ 
                saveString: saveString, 
                lastUpdated: firebase.firestore.FieldValue.serverTimestamp() 
            });
            console.log("Cloud sync complete.");
        } catch (error) {
            console.error("Cloud save error:", error);
        }
    }
};

document.addEventListener('DOMContentLoaded', () => { Cloud.init(); });