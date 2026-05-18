// 1. YOUR FIREBASE CONFIG (Vos clés API officielles de la console Google Cloud)
const firebaseConfig = {
  apiKey: "AIzaSyDtCybmYjWpoCczFvIGtBgOjBb95_WSnRY",
  authDomain: "icon-studio-simulator.firebaseapp.com",
  projectId: "icon-studio-simulator",
  storageBucket: "icon-studio-simulator.firebasestorage.app",
  messagingSenderId: "804178879068",
  appId: "1:804178879068:web:65b5ad93ce6c2c7d5e3c99"
};

// 2. INITIALIZATION
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// 3. CLOUD ENGINE
const Cloud = {
    uid: null,

    init() {
        // Surveille en temps réel l'état de connexion du joueur
        auth.onAuthStateChanged(user => {
            if (user) {
                this.uid = user.uid;
                document.getElementById('account-email-display').innerText = user.email || "Google Connected";
                
                // Étape 1 validée : On ferme le menu de connexion Google/Email
                document.getElementById('auth-modal').classList.remove('active-overlay');
                
                // Étape 2 : On va scanner les données pour l'écran de sélection de profil
                this.checkCloudSave();
            } else {
                this.uid = null;
                // Si déconnecté, on reverrouille tout sur l'écran d'accueil noir
                document.getElementById('auth-modal').classList.add('active-overlay');
                document.getElementById('onboarding-modal').classList.add('hidden');
                document.getElementById('os-environment').classList.add('hidden');
            }
        });
        this.bindEvents();
    },

    bindEvents() {
        // BOUTON : Connexion avec Google Pop-up
        document.getElementById('btn-google-login').onclick = () => {
            const provider = new firebase.auth.GoogleAuthProvider();
            auth.signInWithPopup(provider).catch(err => this.showError(err.message));
        };

        // BOUTON : Connexion Email classique
        document.getElementById('btn-login').onclick = () => {
            const email = document.getElementById('auth-email').value;
            const pass = document.getElementById('auth-password').value;
            auth.signInWithEmailAndPassword(email, pass).catch(err => this.showError("Invalid credentials."));
        };

        // BOUTON : Inscription Email classique
        document.getElementById('btn-signup').onclick = () => {
            const email = document.getElementById('auth-email').value;
            const pass = document.getElementById('auth-password').value;
            if(pass.length < 6) return this.showError("Password too short (min 6 chars).");
            auth.createUserWithEmailAndPassword(email, pass).catch(err => this.showError(err.message));
        };

        // BOUTON : Déconnexion (dans l'onglet Account des paramètres)
        const btnLogout = document.getElementById('btn-logout');
        if (btnLogout) {
            btnLogout.onclick = () => {
                auth.signOut().then(() => { location.reload(); });
            };
        }

        // BOUTON : Force Cloud Sync (sauvegarde immédiate)
        const btnCloudSave = document.getElementById('btn-cloud-save');
        if (btnCloudSave) {
            btnCloudSave.onclick = () => {
                if (this.uid && typeof Engine !== 'undefined') Engine.saveGame(false);
            };
        }

        // BOUTON : Réinitialiser le mot de passe par Email
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

        // BOUTON : Supprimer définitivement le compte cloud
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

    // RECHERCHE DE LA SAUVEGARDE SUR FIRESTORE
    async checkCloudSave() {
        try {
            const docRef = db.collection("players").doc(this.uid);
            const doc = await docRef.get();
            
            // On s'assure que la fenêtre Onboarding est bien visible et active
            const onboarding = document.getElementById('onboarding-modal');
            if (onboarding) {
                onboarding.classList.remove('hidden');
                onboarding.classList.add('active-overlay');
            }

            if (doc.exists && doc.data().saveString) {
                // Sauvegarde trouvée en ligne -> On la synchronise temporairement en local
                localStorage.setItem('studioOS_save', doc.data().saveString);
                
                // On demande à l'interface de scanner le fichier pour afficher les stats en vert (ONLINE)
                if (typeof UI !== 'undefined' && UI.scanLocalSaveForOnboarding) {
                    UI.scanLocalSaveForOnboarding();
                }
                console.log("Cloud save mapped to local diagnostics card.");
            } else {
                // Pas de sauvegarde en ligne -> La carte passera automatiquement en mode "No local profile detected"
                if (typeof UI !== 'undefined' && UI.scanLocalSaveForOnboarding) {
                    UI.scanLocalSaveForOnboarding();
                }
                console.log("No cloud save found. Standing by for initial profile setup.");
            }
        } catch (error) {
            console.error("Cloud load error:", error);
            this.showError("Failed to sync with Cloud Database.");
        }
    },

    // TRANSFERT DE LA SAUVEGARDE VERS LE CLOUD
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

// Lancement automatique du script au démarrage
document.addEventListener('DOMContentLoaded', () => { Cloud.init(); });