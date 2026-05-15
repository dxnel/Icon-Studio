const Game = {
    config: null,
    isLoaded: false,
    async loadConfig() {
        try {
            const response = await fetch('config.json');
            if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
            this.config = await response.json();
            this.config.gear.forEach(g => g.owned = false);
            this.config.achievements.forEach(a => a.unlocked = false);
            this.isLoaded = true;
            console.log("StudioOS Engine: Configuration parsed successfully.");
        } catch (error) {
           console.error("Critical System Error: Failed to load configuration.", error);
           document.getElementById('os-environment').classList.remove('hidden');
           UI.showAlert("System Boot Failure", "config.json missing or failed to parse. Check console.");
        }
    }
};
const ImageCompressor = {
    compress(file, maxDimension, quality, callback) {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;

                // Calcul du ratio pour ne pas déformer l'image
                if (width > height) {
                    if (width > maxDimension) {
                        height = Math.round(height * (maxDimension / width));
                        width = maxDimension;
                    }
                } else {
                    if (height > maxDimension) {
                        width = Math.round(width * (maxDimension / height));
                        height = maxDimension;
                    }
                }

                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                
                // On remplit le fond en noir au cas où c'est un PNG transparent (car on convertit en JPEG)
                ctx.fillStyle = "#121218"; 
                ctx.fillRect(0, 0, width, height);
                ctx.drawImage(img, 0, 0, width, height);

                // On exporte en JPEG (beaucoup plus léger que PNG) avec la qualité choisie
                const compressedBase64 = canvas.toDataURL('image/jpeg', quality);
                callback(compressedBase64);
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    }
};

class LogicEvaluator {
    static resolvePath(path, obj) {
        return path.split('.').reduce((prev, curr) => prev ? prev[curr] : null, obj);
    }
    static checkCondition(cond) {
        let current = 0;
        if (cond.target === 'gear.owned') current = Game.config.gear.filter(g => g.owned).length;
        else if (cond.target === 'hour') current = Engine.state.hour;
        else if (cond.target === 'activeTracks') current = Engine.state.tracks.filter(t => t.status === 'In Progress').length;
        else if (cond.target.startsWith('flag.')) {
            let flagName = cond.target.split('.')[1];
            current = Engine.state.flags[flagName] ? 1 : 0;
        } 
        else {
            try {
                let resolved = this.resolvePath(cond.target, Engine.state);
                current = resolved !== null && resolved !== undefined ? resolved : 0;
            } catch(e) { 
                current = 0; 
                console.warn(`LogicEvaluator: Could not resolve target path '${cond.target}'`);
            }
        }
        switch (cond.operator) {
            case '>=': return current >= cond.value;
            case '>': return current > cond.value;
            case '==': return current === cond.value;
            case '<=': return current <= cond.value;
            case '<': return current < cond.value;
            case '!=': return current !== cond.value;
            default: return false;
        }
    }
    static executeAction(action) {
        switch (action.type) {
            case 'modify': 
                Engine.modifyStat(action.stat, action.value); 
                break;
            case 'add_status': 
                Engine.addStatus(action.statusId, action.duration); 
                break;
            case 'set_flag': 
                if (!Engine.state.flags) Engine.state.flags = {};
                Engine.state.flags[action.flag] = action.value; 
                break;
            case 'modify_percent':
                let amt = Engine.state.player[action.stat] * action.percent;
                if (action.min && Math.abs(amt) < Math.abs(action.min)) amt = action.min; 
                Engine.modifyStat(action.stat, amt);
                break;
            case 'random_pool':
                let roll = Math.random(); let cumulative = 0;
                for (let outcome of action.outcomes) {
                    cumulative += outcome.chance;
                    if (roll <= cumulative) { outcome.actions.forEach(a => this.executeAction(a)); break; }
                }
                break;
            case 'daw_crash':
                Engine.modifyStat('burnout', action.burnout);
                let active = Engine.state.tracks.filter(t => t.status === 'In Progress');
                if (active.length > 0) {
                    let victim = active.reduce((a, b) => b.progress > a.progress ? b : a);
                    let lost = Math.floor(victim.progress * action.progress_loss);
                    victim.progress = Math.max(0, victim.progress - lost);
                    Engine.log(`DAW Crash: "${victim.title}" lost ${lost}% stage progress.`);
                    UI.renderStudio();
                }
                break;
        }
    }
}

class Track {
    constructor(title, genre, bpm, vibe) {
        this.id = 'TRK_' + Math.random().toString(36).substr(2, 9);
        this.title = title; 
        this.genre = genre;
        this.bpm = parseInt(bpm) || 120; 
        this.vibe = vibe;
        this.stages = ['Writing', 'Recording', 'Mixing'];
        this.currentStageIndex = 0; 
        this.progress = 0; 
        this.lyrics = 0;
        this.prod = 0; 
        this.mix = 0;
        this.status = 'In Progress'; 
        this.dspReleaseCount = 0; 
    }
    get currentStage() { return this.stages[this.currentStageIndex]; }
    get quality() { return Math.floor((this.lyrics + this.prod + this.mix) / 3); }
}

class Release {
    constructor(title, formatId, tracks, artData, platforms, distroId, dropDay, visualBoost = 1.0, visualName = "No Video") {
        this.id = 'REL_' + Math.random().toString(36).substr(2, 9);
        this.title = title; 
        this.format = formatId; 
        this.tracks = tracks; 
        this.artData = artData; 
        this.platforms = platforms; 
        this.distro = distroId; 
        this.dropDay = dropDay; 
        this.status = 'Scheduled'; 
        this.streams = 0; 
        this.scPlays = 0;
        this.revenue = 0;
        this.visualName = visualName; 
        
        let formatObj = Game.config.releaseFormats.find(f => f.id === formatId);
        let distroObj = Game.config.distroOptions.find(d => d.id === distroId);
        let formatMult = formatObj ? (formatObj.hypeMult || 1.0) : 1.0;
        let distroBoost = distroObj ? (distroObj.distroBoost || 1.0) : 1.0;

        let rawQual = 0;
        tracks.forEach(t => {
            let tQual = t.quality;
            if (t.genre === Engine.state.trend.genre) tQual *= 1.20; 
            if (t.vibe === Engine.state.trend.mood) tQual *= 1.15; 
            if (Math.abs(t.bpm - Engine.state.trend.bpmBase) <= 10) tQual *= 1.10; 
            if(platforms.includes('dsp')) {
                let penalty = Math.pow(0.1, t.dspReleaseCount); 
                rawQual += (tQual * penalty);
                t.dspReleaseCount++;
            } else { rawQual += tQual; }
        });
        rawQual /= tracks.length;

        let variance = (Math.random() * 0.1) - 0.05; 
        this.retentionRate = Math.min(0.99, 0.45 + (rawQual / 250) + variance); 
        let socialMult = Engine.state.player.hype + (Engine.state.player.followers / 2500); 
        this.hypeRating = rawQual * formatMult * distroBoost * socialMult * visualBoost;
        this.activeMultiplier = 1.0;
    }
}

const Engine = {
    state: {
        day: 1, hour: 8,
        trend: { genre: 'Pop', mood: 'Chill', bpmBase: 120 }, 
        player: { 
            name: "", bio: "Hey there!", avatar: null, 
            money: 50, energy: 100, burnout: 0, followers: 0, hype: 1.0, 
            caps: { writing: 10, recording: 10, mixing: 10 },
            jobId: 'barista', perkId: 'writer', untitledCount: 0, lastWorkDay: 0,
            propertyId: 'prop_basement',
            statuses: [], challenges: [] 
        },
        flags: {},
        preferences: { autosave: false },
        cooldowns: { jobChange: 0, work: 0, sleep: 0 },
        stats: { singles: 0, eps: 0, mixtapes: 0, albums: 0, doubles: 0, totalStreams: 0, totalRevenue: 0, completedChallenges: 0, merchRevenue: 0, merchItemsSold: 0, merchHistory: [0, 0, 0, 0, 0, 0, 0] },
        tracks: [], releases: [], chartHistory: [0, 0, 0, 0, 0, 0, 0], bots: [],
        availableContracts: [], networkCooldown: 0,
        inventory: {},           
        inventoryVelocity: {},   
        staff: []                
    },
    chart: null, artBuffer: null, pendingTracklist: [], activeEvent: null,

    initGame(isNewGame = false) {
        if (!Game.isLoaded) return console.error("Cannot initialize. Config not loaded.");
        if(isNewGame) {
            this.state.inventory = {};
            this.state.inventoryVelocity = {};
            this.state.staff = [];
            this.state.player.name = document.getElementById('artist-name').value || "Nobody";
            this.state.player.jobId = document.getElementById('player-job').value;
            this.state.player.perkId = document.getElementById('player-perk').value;
            Game.config.settings.botNames.forEach(name => {
                this.state.bots.push({ name: name, dailyStreams: Math.floor(Math.random() * 8000) + 500 });
            });
            this.rollWeeklyTrend();
            const pTrait = Game.config.perks.find(p => p.id === this.state.player.perkId).title;
            const pJob = Game.config.jobs.find(j => j.id === this.state.player.jobId).title;
            this.log(`Profile Booted. Trait: ${pTrait}. Job: ${pJob}.`);
        } else {
            this.log("Profile Booted from Save.");
        }
        UI.closeModal('onboarding-modal');
        document.getElementById('os-environment').classList.remove('hidden');
        lucide.createIcons(); 
        UI.initChart(); 
        UI.updateClock();
        UI.updateVitals(); 
        UI.renderStudio();
        UI.renderVault();
        UI.renderReleases();
        UI.renderGear(); 
        UI.renderLeaderboard();
        UI.renderMilestones();
        UI.renderStatuses();
        UI.renderContracts();
        UI.renderSettings();
        UI.renderPromos();
        UI.renderHQ();
        UI.renderMerch();
        Progression.check();
        if (isNewGame && this.state.preferences.autosave) {
            this.saveGame(true);
        }
    },
    saveGame(silent = false) {
        const saveData = {
            state: this.state,
            gear: Game.config.gear, 
            achievements: Game.config.achievements
        };
        
        try {
            // On essaie de sauvegarder
            localStorage.setItem('studioOS_save', JSON.stringify(saveData));
            
            // Si ça marche et que ce n'est pas silencieux, on affiche le succès
            if (!silent) {
                UI.showAlert("Game Saved", "Your progress has been stored locally.");
            }
        } catch (error) {
            // Si ça plante (ex: Stockage plein à cause des images)
            console.error("Save failed:", error);
            
            // On force l'affichage d'une alerte, même si c'était un autosave silencieux
            if (error.name === 'QuotaExceededError' || error.code === 22) {
                UI.showAlert("Save Failed: Storage Full", "Your save file is too large! This usually happens when uploading high-resolution custom cover arts. Try using smaller images.");
            } else {
                UI.showAlert("Save Failed", "An unknown error prevented the game from saving. Check the console.");
            }
        }
    },
    loadGame(fromBoot = false) {
        if (!Game.isLoaded) return console.error("Cannot load game. Config not loaded.");
        let saveData = localStorage.getItem('studioOS_save');
        if(!saveData) return UI.showAlert("No Save Found", "There is no saved data on this browser.");
        let parsed = JSON.parse(saveData);
        this.state = parsed.state;
        if(!this.state.cooldowns) this.state.cooldowns = { jobChange: 0, work: 0, sleep: 0 };
        if(!this.state.flags) this.state.flags = {};
        if(!this.state.preferences) this.state.preferences = { autosave: true };
        if(!this.state.player.statuses) this.state.player.statuses = [];
        if(!this.state.player.challenges) this.state.player.challenges = [];
        if(!this.state.availableContracts) this.state.availableContracts = [];
        if(!this.state.networkCooldown) this.state.networkCooldown = 0;
        if(this.state.stats.completedChallenges === undefined) this.state.stats.completedChallenges = 0;
        if(this.state.stats.totalRevenue === undefined) this.state.stats.totalRevenue = 0;
        if(this.state.stats.mixtapes === undefined) { this.state.stats.mixtapes = 0; this.state.stats.doubles = 0; }
        if(!this.state.player.propertyId) this.state.player.propertyId = 'prop_basement';
        if(!this.state.inventory) this.state.inventory = {};
        if(this.state.stats.merchRevenue === undefined) this.state.stats.merchRevenue = 0;
        if(this.state.stats.merchItemsSold === undefined) this.state.stats.merchItemsSold = 0;
        if(!this.state.stats.merchHistory) this.state.stats.merchHistory = [0, 0, 0, 0, 0, 0, 0];
        if(!this.state.staff) this.state.staff = [];
        if(!this.state.inventoryVelocity) this.state.inventoryVelocity = {};
        this.state.tracks = this.state.tracks.map(t => Object.assign(new Track(t.title, t.genre, t.bpm, t.vibe), t));
        this.state.releases = this.state.releases.map(r => {
            r.tracks = r.tracks.map(t => Object.assign(new Track(t.title, t.genre, t.bpm, t.vibe), t));
            return Object.assign(new Release(r.title, r.format, r.tracks, r.artData, r.platforms, r.distroId, r.dropDay, r.visualBoost, r.visualName), r);
        });
        Game.config.gear = parsed.gear;
        parsed.achievements.forEach(loadedAch => {
            let original = Game.config.achievements.find(a => a.id === loadedAch.id);
            if(original) original.unlocked = loadedAch.unlocked;
        });
        if(fromBoot) this.initGame(false); 
        UI.closeModal('settings-modal');
        UI.updateVitals(); 
        UI.renderStudio(); 
        UI.renderVault(); 
        UI.renderReleases(); 
        UI.renderGear();
        UI.updateClock(); 
        UI.updateChart(0);
        UI.renderStatuses();
        UI.renderContracts();
        UI.renderSettings();
        UI.renderPromos();
        UI.renderHQ();
        UI.renderMerch();
        UI.showAlert("Game Loaded", "Welcome back, " + this.state.player.name);
    },
    resetGame() {
        UI.showConfirm("Hard Reset", "Are you sure? This will permanently wipe all local save data.", () => {
            localStorage.removeItem('studioOS_save');
            location.reload();
        });
    },
    addStatus(id, hours) {
        let existing = this.state.player.statuses.find(s => s.id === id);
        if (existing) { existing.hoursLeft = Math.max(existing.hoursLeft, hours); } 
        else { this.state.player.statuses.push({ id: id, hoursLeft: hours }); }
        UI.renderStatuses();
        this.log(`STATUS UPDATE: ${Game.config.statuses[id].name} (${hours}h)`);
    },
    getMultiplier(type) {
        let mult = 1.0;
        if (!this.state.player.statuses) return mult;
        this.state.player.statuses.forEach(s => {
            let sConf = Game.config.statuses[s.id];
            if (sConf && sConf.modifiers && sConf.modifiers[type]) mult *= sConf.modifiers[type];
        });
        return mult;
    },
    modifyStat(stat, amt) {
        if (stat === 'money' && amt !== 0) UI.showFloatingMoney(amt); 
        this.state.player[stat] += amt;
        if(stat==='energy' || stat==='burnout') this.state.player[stat] = Math.max(0, Math.min(100, this.state.player[stat]));
        if(stat==='hype') this.state.player[stat] = Math.max(1.0, this.state.player[stat]);
        UI.updateVitals();
        Progression.check();
    },
    modifyBio(newBio) { this.state.player.bio = newBio; },
    rollWeeklyTrend() {
        const genres = Game.config.settings.genres;
        const moods = Game.config.settings.moods;
        this.state.trend.genre = genres[Math.floor(Math.random() * genres.length)];
        this.state.trend.mood = moods[Math.floor(Math.random() * moods.length)];
        this.state.trend.bpmBase = Math.floor(Math.random() * 80) + 80; 
        document.getElementById('trend-display').innerText = `${this.state.trend.genre} | ${this.state.trend.mood} | ~${this.state.trend.bpmBase} BPM`;
    },
    log(msg) {
        const logBox = document.getElementById('activity-log');
        logBox.innerHTML = `<div class="log-entry"><span class="time">[D${this.state.day} ${this.state.hour.toString().padStart(2,'0')}:00]</span> ${msg}</div>` + logBox.innerHTML;
    },
    executeCheat() {
        const input = document.getElementById('admin-code-input').value.trim().toUpperCase();
        document.getElementById('admin-code-input').value = "";
        if (!input) return;

        if (input.startsWith("AUTH ")) {
            let pwd = input.split(" ")[1];
            if (btoa(pwd) === "TUFTVEVS") { 
                sessionStorage.setItem('adminUnlocked', 'true');
                UI.showAlert("Terminal Unlocked", "Admin privileges granted for this session.");
            } else {
                UI.showAlert("Access Denied", "Incorrect password.");
            }
            return;
        }

        if (sessionStorage.getItem('adminUnlocked') !== 'true') {
            return UI.showAlert("Locked", "Terminal requires authentication. Type: AUTH &lt;password&gt;");
        }

        let parts = input.split(" ");
        let command = parts[0];
        if (command === "GODMODE" || command === "MAXOUT") {
            this.modifyStat('money', 99999999 - this.state.player.money);
            this.modifyStat('followers', 99999999 - this.state.player.followers);
            this.modifyStat('hype', 50.0);
            this.state.player.energy = 100;
            this.state.player.burnout = 0;
            Game.config.gear.forEach(g => {
                if (!g.owned) {
                    g.owned = true;
                    Engine.log(`Purchased Studio Gear: ${g.name}`);
                    this.state.player.caps[g.capType] += g.capIncrease;
                }
            });
            Game.config.achievements.forEach(a => { a.unlocked = true; });
            UI.showAlert("God Mode Activated", "Unlimited resources, maximum hype, all gear installed, and all milestones unlocked.");
            this.log("WARNING: Reality matrix compromised. God Mode active.");
            UI.renderGear(); UI.renderMilestones(); UI.updateVitals(); UI.closeModal('settings-modal');
            return;
        }
        switch(command) {
            case "ADD":
                if (parts.length >= 3) {
                    let stat = parts[1].toLowerCase();
                    let amt = parseFloat(parts[2]);
                    if (stat === 'fans') stat = 'followers'; 
                    if (this.state.player[stat] !== undefined && !isNaN(amt)) {
                        this.modifyStat(stat, amt);
                        UI.showAlert("Admin Mode", `Added ${amt} to ${stat}.`);
                        UI.renderHQ();
                        if (UI.renderMerch) UI.renderMerch();
                        UI.renderGear();
                        UI.renderPromos();
                    } else UI.showAlert("Admin Error", "Invalid stat or amount. Try: ADD MONEY 500");
                }
                break;
            case "SET":
                if (parts.length >= 3) {
                    let stat = parts[1].toLowerCase();
                    let amt = parseFloat(parts[2]);
                    if (stat === 'fans') stat = 'followers';
                    if (this.state.player[stat] !== undefined && !isNaN(amt)) {
                        let diff = amt - this.state.player[stat];
                        this.modifyStat(stat, diff);
                        UI.showAlert("Admin Mode", `Set ${stat} to ${amt}.`);
                        UI.renderHQ();
                        if (UI.renderMerch) UI.renderMerch();
                        UI.renderGear();
                        UI.renderPromos();
                    } else UI.showAlert("Admin Error", "Invalid stat or amount.");
                }
                break;
            case "STATUS":
                if (parts.length >= 2) {
                    let statusId = parts[1].toLowerCase();
                    let hours = parseInt(parts[2]) || 24;
                    if (Game.config.statuses[statusId]) {
                        this.addStatus(statusId, hours);
                        UI.showAlert("Admin Mode", `Force-applied status: ${statusId} for ${hours}h`);
                    } else UI.showAlert("Admin Error", `Status ID '${statusId}' not found in config.json.`);
                }
                break;
            case "CLEAR":
                if (parts[1] === "STATUS") {
                    this.state.player.statuses = [];
                    UI.renderStatuses();
                    UI.showAlert("Admin Mode", "All active status effects cleared.");
                }
                break;
            case "MIDGAME":
                this.state.player.money = 25000;
                this.state.player.followers = 75000;
                this.state.player.hype = 2.5;
                this.state.player.propertyId = 'prop_warehouse';
                const gearToUnlock = ['gw1', 'gw2', 'gr1', 'gr2', 'gm1', 'gm2'];
                Game.config.gear.forEach(g => {
                    if (gearToUnlock.includes(g.id)) {
                        g.owned = true;
                        this.state.player.caps[g.capType] = Math.max(this.state.player.caps[g.capType], 10 + g.capIncrease);
                    }
                });
                if (!this.state.staff.includes('staff_merch')) this.state.staff.push('staff_merch');
                if (!this.state.staff.includes('staff_pr')) this.state.staff.push('staff_pr');
                if (this.state.releases.length === 0) {
                    const genres = Game.config.settings.genres;
                    const moods = Game.config.settings.moods;
                    let proTracks = [];
                    for (let i = 0; i < 5; i++) {
                        let t = new Track(`Legacy Hit ${i+1}`, genres[i % genres.length], 120, moods[i % moods.length]);
                        t.lyrics = 55; t.prod = 55; t.mix = 55;
                        t.status = 'Ready';
                        t.dspReleaseCount = 1;
                        proTracks.push(t);
                    }
                    for (let i = 0; i < 2; i++) {
                        let rel = new Release(`Single ${i+1}`, 'Single', [proTracks[i]], null, ['sc', 'dsp'], 'dk', this.state.day - 10);
                        rel.status = 'Live';
                        rel.streams = 50000 + (Math.random() * 20000);
                        this.state.releases.push(rel);
                        this.state.stats.singles++;
                    }
                    let epTracks = [proTracks[2], proTracks[3], proTracks[4]];
                    let ep = new Release("Mid-Game EP", 'EP', epTracks, null, ['sc', 'dsp'], 'dk', this.state.day - 5);
                    ep.status = 'Live';
                    ep.streams = 120000;
                    this.state.releases.push(ep);
                    this.state.stats.eps++;
                    this.state.chartHistory = [1200, 2500, 4800, 8900, 12000, 15000, 18500];
                    this.state.stats.totalStreams = 350000;
                    this.state.stats.totalRevenue = 1155;
                }
                UI.showAlert("Admin: Mid-Game Boot", "Resources set. Team hired. Live Discography generated in Vault.");
                this.log("Admin: State forced to Mid-Game configuration with released tracks.");
                UI.updateVitals();
                UI.renderHQ();
                UI.renderMerch();
                UI.renderGear();
                UI.renderVault();
                UI.renderReleases();
                UI.renderPromos();
                UI.renderMilestones();
                UI.renderLeaderboard();
                UI.initChart();
                UI.closeModal('settings-modal');
                break;
            default:
                UI.showAlert("Access Denied", "Invalid Admin Command.");
                break;
                case "STRESS-TEST":
    // 1. Remplir le Studio (Sessions actives)
    for (let i = 1; i <= 50; i++) {
        let t = new Track(`Stress Track ${i}`, "Hyperpop", 160, "Aggressive");
        t.progress = Math.floor(Math.random() * 90);
        t.lyrics = 10; t.prod = 10; t.mix = 10;
        Engine.state.tracks.push(t);
    }

    // 2. Remplir le Vault (Masters prêts)
    for (let i = 1; i <= 50; i++) {
        let t = new Track(`Vault Monster ${i}`, "Drill", 140, "Dark");
        t.status = 'Ready';
        t.lyrics = 50; t.prod = 50; t.mix = 50;
        Engine.state.tracks.push(t);
    }

    // 3. Remplir les contrats (Board)
    for (let i = 1; i <= 50; i++) {
        Engine.state.availableContracts.push({
            instanceId: 'stress_' + i,
            title: `Evil Contract ${i}`,
            desc: "This is a duplicated test lead to check scroll physics.",
            reward: 9999,
            penalty: 666,
            timeLimitDays: 7
        });
    }

    // 4. Remplir la Discographie (Releases live)
    for (let i = 1; i <= 50; i++) {
        let rel = new Release(`Classic Hit ${i}`, 'Single', [Engine.state.tracks[0]], null, ['dsp'], 'dk', Engine.state.day - 1);
        rel.status = 'Live';
        rel.streams = Math.floor(Math.random() * 1000000);
        rel.revenue = rel.streams * 0.0033;
        Engine.state.releases.push(rel);
    }

    // 5. Remplir l'Inventaire (Merch)
    Game.config.merch.forEach(item => {
        let key = item.id;
        Engine.state.inventory[key] = 9999;
    });

    UI.showAlert("⚠️ STRESS TEST ACTIVÉ", "Toutes les zones de scroll sont maintenant saturées. Bonne chance pour le débug !");
    
    // Refresh global de l'UI
    UI.renderStudio();
    UI.renderVault();
    UI.renderContracts();
    UI.renderReleases();
    UI.renderMerch();
    break;
        }
        UI.closeModal('settings-modal');
    }
};

const Progression = {
    check() {
        Game.config.achievements.forEach(a => {
            if (!a.unlocked && LogicEvaluator.checkCondition(a.condition)) {
                a.unlocked = true;
                Engine.modifyStat('money', a.reward);
                Engine.log(`MILESTONE: ${a.title} reached. Rewarded $${a.reward}.`);
                UI.showAlert("Milestone Reached!", `You achieved "${a.title}". Rewarded $${a.reward}.`);
            }
        });
        UI.renderMilestones();
        UI.renderGear(); 
    }
};

const TimeManager = {
    isBusy: false,
    getCurrentTime() { return (Engine.state.day * 24) + Engine.state.hour; },
    async passTime(hours, activityName) {
        if (this.isBusy) return;
        this.isBusy = true;
        const blocker = document.getElementById('action-blocker');
        document.getElementById('blocker-text').innerText = activityName + "...";
        blocker.classList.remove('hidden'); 
        await new Promise(r => requestAnimationFrame(r)); 
        blocker.classList.add('active'); 
        let context = 'global';
        if (activityName.includes("Job")) context = 'job';
        if (activityName.includes("Studio")) context = 'studio';
        if (activityName.includes("Content")) context = 'social';
        for (let i = 0; i < hours; i++) {
            await new Promise(r => setTimeout(r, 120)); 
            Engine.state.hour++;
            if (Engine.state.player.statuses && Engine.state.player.statuses.length > 0) {
                Engine.state.player.statuses.forEach(s => {
                    s.hoursLeft--;
                    if (s.hoursLeft <= 0) Engine.log(`Status Cleared: ${Game.config.statuses[s.id].name}`);
                });
                Engine.state.player.statuses = Engine.state.player.statuses.filter(s => s.hoursLeft > 0);
            }
            if (Engine.state.cooldowns && Engine.state.cooldowns.sleep > 0) Engine.state.cooldowns.sleep--; 
            if (Engine.state.hour >= 24) { 
                Engine.state.hour -= 24; 
                Engine.state.day++; 
                this.handleDailyTick(); 
            }
            UI.updateClock();
        }
        blocker.classList.remove('active'); 
        setTimeout(() => { blocker.classList.add('hidden'); this.isBusy = false; }, 300);
        UI.updateVitals();
        UI.renderStatuses();
        if (Math.random() < 0.15) setTimeout(() => EventEngine.triggerEvent(context), 300);
        if (Engine.state.player.burnout >= 100) {
            Engine.log("CRITICAL BURNOUT! Hospitalised. You lost 2 days.");
            Engine.modifyStat('burnout', -100); Engine.modifyStat('energy', 100);
            setTimeout(() => this.passTime(48, "Hospitalized"), 500); 
        }
        if (Engine.state.preferences && Engine.state.preferences.autosave) {
            Engine.saveGame(true);
        }
    },
    processDailyStreams(rel, coreFans) {
        let streamsGenerated = 0;
        let revGenerated = 0;
        if (rel.platforms.includes('dsp')) {
            let statusHypeMult = Engine.getMultiplier('hypeMult');
            let statusDspMult = Engine.getMultiplier('dspMult');
            let algoPush = (rel.hypeRating * statusHypeMult * rel.activeMultiplier) * (Math.random() * 0.8 + 0.2);
            let fanPush = coreFans * (Math.random() * 0.02 + 0.025);
            let dspGen = Math.floor((algoPush + fanPush) * statusDspMult);
            rel.streams += dspGen; 
            streamsGenerated += dspGen; 
            let rev = dspGen * Game.config.settings.streamPayoutRate;
            rel.revenue = (rel.revenue || 0) + rev; 
            revGenerated += rev;
            let dspFans = dspGen * 0.005; 
            let wholeDspFans = Math.floor(dspFans);
            if (Math.random() < (dspFans - wholeDspFans)) wholeDspFans++;
            if (wholeDspFans > 0) Engine.modifyStat('followers', wholeDspFans);
        }
        if (rel.platforms.includes('sc')) {
            let statusHypeMult = Engine.getMultiplier('hypeMult');
            let scHypeWeight = 1.0 + ((rel.hypeRating * statusHypeMult) - 1.0) * 0.35; 
            let algoPush = scHypeWeight * rel.activeMultiplier * (Math.random() * 1.5 + 0.5) * 2.2;
            let fanPush = coreFans * (Math.random() * 0.02 + 0.015);
            let scGen = Math.floor(algoPush + fanPush);
            rel.scPlays += scGen; 
            let scFans = scGen * 0.015;
            let wholeScFans = Math.floor(scFans);
            if (Math.random() < (scFans - wholeScFans)) wholeScFans++;
            if (wholeScFans > 0) Engine.modifyStat('followers', wholeScFans);
        }
        rel.activeMultiplier *= rel.retentionRate;
        return { streams: streamsGenerated, rev: revGenerated };
    },
    handleDailyTick() {
        let dailyStreams = 0;
        let dailyMoney = 0; 
        if (Math.random() < 0.25 + (Engine.state.player.followers / 200000)) {
            ChallengeEngine.generateRandomContract();
        }
        if (Engine.state.player.money < 0) {
            Engine.modifyStat('burnout', Game.config.settings.debtPenaltyStress);
            Engine.log("DEBT PENALTY: Financial stress is mounting. (+10 Stress)");
        }
        if (Engine.state.day > 1 && Engine.state.day % Game.config.settings.rentIntervalDays === 0) { 
            Engine.modifyStat('money', -Game.config.settings.rentCost); 
            Engine.rollWeeklyTrend(); 
            UI.showAlert("Rent Due", `Another month passed. $${Game.config.settings.rentCost} was deducted for rent & bills. (If you drop below $0, you will rapidly gain stress).`);
            Engine.log(`Monthly Rent Deducted: -$${Game.config.settings.rentCost}`);
        } else if (Engine.state.day % 7 === 0) {
            Engine.rollWeeklyTrend(); 
        }
        Engine.state.releases.forEach(rel => {
            if (rel.status === 'Scheduled' && Engine.state.day >= rel.dropDay) {
                rel.status = 'Live';
                Engine.log(`Release is LIVE: ${rel.title}`);
                if (rel.format === 'Single') Engine.state.stats.singles++;
                else if (rel.format === 'EP') Engine.state.stats.eps++;
                else if (rel.format === 'Mixtape') Engine.state.stats.mixtapes++;
                else if (rel.format === 'Double') Engine.state.stats.doubles++;
                else Engine.state.stats.albums++;
                Progression.check(); UI.renderReleases();
            }
            if (rel.status === 'Live') {
                let coreFans = Engine.state.player.followers * rel.activeMultiplier;
                let generated = this.processDailyStreams(rel, coreFans);
                dailyStreams += generated.streams;
                dailyMoney += generated.rev;
            }
        });
        Engine.state.stats.totalStreams += dailyStreams;
        Engine.state.stats.totalRevenue += dailyMoney;
        Engine.state.bots.forEach(bot => { bot.dailyStreams = Math.floor(bot.dailyStreams * (Math.random() * 0.5 + 0.7)); });
        let hypeDecayMult = Engine.state.staff.includes('staff_pr') ? 0.5 : 1.0;
        if (Engine.state.player.hype > 1.0) {
            let excessHype = Engine.state.player.hype - 1.0;
            let decay = Math.max(0.02, excessHype * 0.15) * hypeDecayMult; 
            Engine.modifyStat('hype', -decay);
        }
        if (Engine.state.staff.includes('staff_manager') && Math.random() < 0.4) {
            ChallengeEngine.generateRandomContract();
        }
        if (Engine.state.staff.includes('staff_ghost')) {
            Engine.state.tracks.filter(t => t.status === 'In Progress').forEach(t => {
                t.lyrics = Math.min(Engine.state.player.caps.writing, t.lyrics + 5);
                t.prod = Math.min(Engine.state.player.caps.recording, t.prod + 5);
                t.mix = Math.min(Engine.state.player.caps.mixing, t.mix + 5);
                t.progress = Math.min(99, t.progress + 15);
            });
            if (UI.renderStudio) UI.renderStudio();
        }
        let superfans = Math.floor(Engine.state.player.followers * 0.08);
        let dailyMerchRev = 0; let dailyMerchItems = 0;
        Engine.state.inventoryVelocity = {};
        if (Engine.state.inventory) {
            Object.keys(Engine.state.inventory).forEach(invKey => {
                let stock = Engine.state.inventory[invKey];
                if (stock > 0) {
                    let [itemId, releaseId] = invKey.split('|');
                    let itemDef = Game.config.merch.find(m => m.id === itemId);
                    if (itemDef) {
                        let demand = itemDef.demandFactor * Engine.state.player.hype;
                        let linkedRelease = releaseId ? Engine.state.releases.find(r => r.id === releaseId) : null;
                        if (linkedRelease) demand *= Math.max(0.1, linkedRelease.activeMultiplier); 
                        let dailyBuyers = Math.floor(superfans * (Math.random() * 0.005 + 0.001) * demand);
                        let sold = Math.min(stock, dailyBuyers);
                        if (sold > 0) {
                            Engine.state.inventoryVelocity[invKey] = sold;
                            Engine.state.inventory[invKey] -= sold;
                            dailyMerchRev += (sold * itemDef.retailPrice);
                            dailyMerchItems += sold;
                            if (linkedRelease && itemDef.category === 'physical') {
                                let streamBoost = sold * 1500;
                                linkedRelease.streams += streamBoost;
                                dailyStreams += streamBoost; 
                            }
                        }
                    }
                }
            });
        }
        Engine.state.stats.merchRevenue += dailyMerchRev;
        Engine.state.stats.merchItemsSold += dailyMerchItems;
        dailyMoney += dailyMerchRev;
        Engine.state.stats.merchHistory.push(dailyMerchRev);
        Engine.state.stats.merchHistory.shift();
        if (UI.merchChart) { UI.merchChart.data.datasets[0].data = Engine.state.stats.merchHistory; UI.merchChart.update(); }
        let itemsLogSuffix = "";
        if (dailyMerchItems > 0) {
            if (!Engine.state.staff.includes('staff_merch')) {
                let drain = Math.min(50, Math.ceil(dailyMerchItems * 0.2)); 
                Engine.modifyStat('energy', -drain);
                itemsLogSuffix = ` | ${dailyMerchItems} items sold (-${drain} Nrg)`;
            } else {
                itemsLogSuffix = ` | ${dailyMerchItems} items sold (Auto-packed)`;
            }
        }
        let dailyWages = 0;
        Engine.state.staff.forEach(staffId => {
            let staffDef = Game.config.staff.find(s => s.id === staffId);
            if (staffDef) dailyWages += staffDef.wage;
        });
        dailyMoney -= dailyWages; 
        Engine.modifyStat('money', dailyMoney); 
        if (dailyStreams > 0 || dailyMoney !== 0 || dailyMerchItems > 0) {
            let logMsg = `Day ${Engine.state.day-1}: ${dailyStreams.toLocaleString()} streams | $${dailyMoney.toFixed(2)} net`;
            if (dailyWages > 0) logMsg += ` (-$${dailyWages} wages)`;
            logMsg += itemsLogSuffix;
            Engine.log(logMsg + ".");
        }
        ChallengeEngine.checkFailures();
        UI.updateChart(dailyStreams); UI.renderReleases(); UI.renderLeaderboard();
        if (UI.renderMerch) UI.renderMerch();
        Progression.check();
        if (Engine.state.preferences && Engine.state.preferences.autosave) {
            Engine.saveGame(true);
        }
    }
};

const EventEngine = {
    triggerEvent(context = 'global') {
        let pool = [];
        const checkEvent = (ev) => {
            if (!ev.conditions) return true;
            return ev.conditions.every(c => LogicEvaluator.checkCondition(c));
        };
        Game.config.events[context].forEach(ev => { if(checkEvent(ev)) pool.push(ev); });
        Game.config.events.global.forEach(ev => { if(checkEvent(ev)) pool.push(ev); });
        if (PlayerActions.currentAction === 'pass') pool = pool.filter(ev => ev.title !== "Good Rest");
        if (pool.length === 0) return; 
        const ev = pool[Math.floor(Math.random() * pool.length)];
        const modalBox = document.getElementById('event-box');
        const header = document.getElementById('event-header-content');
        const choicesBox = document.getElementById('event-choices');
        modalBox.className = 'modal'; 
        if (ev.type === 'good') header.innerHTML = `<i data-lucide="party-popper" class="text-green"></i> <span class="text-green">${ev.title}</span>`;
        else if (ev.type === 'bad') header.innerHTML = `<i data-lucide="alert-octagon" class="text-red"></i> <span class="text-red">${ev.title}</span>`;
        else header.innerHTML = `<i data-lucide="help-circle" class="text-yellow"></i> <span class="text-yellow">${ev.title}</span>`;
        document.getElementById('event-desc').innerText = ev.desc;
        choicesBox.innerHTML = '';
        if (ev.choices) {
            ev.choices.forEach(c => {
                let btn = document.createElement('button');
                btn.className = 'btn-outline w-100'; btn.innerText = c.label;
                btn.onclick = () => { c.actions.forEach(a => LogicEvaluator.executeAction(a)); UI.closeModal('event-modal'); Engine.activeEvent = null; };
                choicesBox.appendChild(btn);
            });
        } else {
            let btn = document.createElement('button');
            btn.className = 'btn-primary w-100'; btn.innerText = 'Understood';
            btn.onclick = () => { ev.actions.forEach(a => LogicEvaluator.executeAction(a)); UI.closeModal('event-modal'); Engine.activeEvent = null; };
            choicesBox.appendChild(btn);
        }
        Engine.activeEvent = ev; 
        UI.openModal('event-modal'); 
        lucide.createIcons();
    }
};

const ChallengeEngine = {
    pendingContract: null,
    generateRandomContract() {
        if(Engine.state.availableContracts.length >= 3) return; 
        let templates = Game.config.challengeTemplates;
        let selected = Object.assign({}, templates[Math.floor(Math.random() * templates.length)]);
        selected.instanceId = 'ac_' + Date.now() + Math.floor(Math.random()*1000);
        Engine.state.availableContracts.push(selected);
        UI.renderContracts();
    },
    network() {
        if (Engine.state.player.energy < 15) return UI.showAlert("Energy Low", "Networking takes effort. You need at least <span class=\"text-orange\">15 Energy</span> to reach out to contacts.");
        let currentTime = TimeManager.getCurrentTime();
        if (currentTime < Engine.state.networkCooldown) {
            let hoursLeft = Engine.state.networkCooldown - currentTime;
            return UI.showAlert("Networking Fatigue", `You've exhausted your contacts for now. Try again in <span class=\"text-blue\">${hoursLeft} hours</span>.`);
        }
        UI.showConfirm("Network for Leads", "Spend <span class=\"text-orange\">15 Energy</span> and <span class=\"text-blue\">2 Hours</span> to reach out to industry contacts? There is no guarantee they will offer a contract immediately.", async () => {
            await TimeManager.passTime(2, "Networking");
            Engine.modifyStat('energy', -15);
            Engine.state.networkCooldown = TimeManager.getCurrentTime() + 12;
            let successChance = 0.3 + (Engine.state.player.followers / 100000);
            if (Math.random() < successChance) {
                this.generateRandomContract();
                UI.showAlert("Lead Found!", "An A&R or brand got back to you with a potential contract. Check the board!");
            } else {
                UI.showAlert("No Leads", "Nobody is biting right now. Build up your fanbase and try again later.");
            }
            if (Engine.state.preferences.autosave) Engine.saveGame(true);
        });
    },
    openContractModal(instanceId) {
        let contract = Engine.state.availableContracts.find(c => c.instanceId === instanceId);
        if(!contract) return;
        this.pendingContract = contract;
        document.getElementById('contract-title').innerText = contract.title;
        document.getElementById('contract-desc').innerText = contract.desc;
        document.getElementById('contract-reward').innerText = contract.reward;
        document.getElementById('contract-penalty').innerText = contract.penalty;
        document.getElementById('contract-time').innerText = contract.timeLimitDays;
        UI.openModal('contract-modal');
        lucide.createIcons();
    },
    acceptContract() {
        if(!this.pendingContract) return;
        let c = {
            id: this.pendingContract.id + '_' + Date.now(),
            title: this.pendingContract.title,
            desc: this.pendingContract.desc,
            reward: this.pendingContract.reward,
            penalty: this.pendingContract.penalty,
            targetType: this.pendingContract.targetType,
            targetValue: this.pendingContract.targetValue,
            deadline: Engine.state.day + this.pendingContract.timeLimitDays
        };
        Engine.state.player.challenges.push(c);
        Engine.state.availableContracts = Engine.state.availableContracts.filter(ac => ac.instanceId !== this.pendingContract.instanceId);
        UI.closeModal('contract-modal');
        UI.renderContracts();
        UI.renderStatuses();
        Engine.log(`Contract Signed: ${c.title}. You have ${this.pendingContract.timeLimitDays} days.`);
        this.pendingContract = null;
        if (Engine.state.preferences.autosave) Engine.saveGame(true);
    },
    trigger(type, payload) {
        if(!Engine.state.player.challenges) return;
        let toRemove = [];
        Engine.state.player.challenges.forEach(c => {
            if(c.targetType === type) {
                let complete = false;
                if(type === 'finish_track') complete = true;
                if(type === 'quality_track' && payload.quality >= c.targetValue) complete = true;
                if(type === 'release_format' && payload.format === c.targetValue) complete = true;
                if(complete) {
                    Engine.modifyStat('money', c.reward);
                    Engine.state.stats.completedChallenges++;
                    Engine.log(`CONTRACT FULFILLED: ${c.title}. Rewarded $${c.reward}.`);
                    UI.showAlert("Contract Fulfilled", `You completed "${c.title}" and earned $${c.reward}.`);
                    toRemove.push(c.id);
                    Progression.check();
                }
            }
        });
        if(toRemove.length > 0) {
            Engine.state.player.challenges = Engine.state.player.challenges.filter(c => !toRemove.includes(c.id));
            UI.renderStatuses();
            if (Engine.state.preferences.autosave) Engine.saveGame(true);
        }
    },
    checkFailures() {
        if(!Engine.state.player.challenges) return;
        let toRemove = [];
        Engine.state.player.challenges.forEach(c => {
            if(Engine.state.day >= c.deadline) {
                Engine.modifyStat('money', -c.penalty);
                Engine.modifyStat('burnout', 15);
                Engine.log(`CONTRACT FAILED: ${c.title}. Penalized $${c.penalty}.`);
                UI.showAlert("Contract Failed", `You missed the deadline for "${c.title}". You lost $${c.penalty} and gained 15% stress.`);
                toRemove.push(c.id);
            }
        });
        if(toRemove.length > 0) {
            Engine.state.player.challenges = Engine.state.player.challenges.filter(c => !toRemove.includes(c.id));
            UI.renderStatuses();
            if (Engine.state.preferences.autosave) Engine.saveGame(true);
        }
    }
};

const PlayerActions = {
    currentAction: null, 
    openLifeModal(type) {
        const player = Engine.state.player;
        const sleepCD = Engine.state.cooldowns.sleep || 0;
        this.currentAction = type;
        const slider = document.getElementById('life-hours-slider');
        slider.value = 8;
        if (type === 'sleep') {
            const isExhausted = player.energy < 30;
            if (sleepCD > 0 && !isExhausted) return UI.showAlert("Not Tired", `Your mind is still racing! You'll be tired again in ${sleepCD}h, or once your energy drops below 30%.`);
            document.getElementById('life-modal-title').innerHTML = `<i data-lucide="bed"></i> ${isExhausted ? 'Emergency Nap' : 'Rest / Sleep'}`;
            document.getElementById('confirm-life-btn').innerText = "GO TO SLEEP";
            document.getElementById('job-info-box').style.display = 'none';
        } else {
            if (Engine.state.player.lastWorkDay === Engine.state.day) return UI.showAlert("Shift Completed", "You've already clocked out for today! Your manager expects you back at the start of next shift.");
            document.getElementById('life-modal-title').innerHTML = `<i data-lucide="briefcase"></i> Day Job`;
            document.getElementById('confirm-life-btn').innerText = "START SHIFT";
            document.getElementById('job-info-box').style.display = 'flex';
            this.updateJobInfoDisplay();
        }
        UI.updateLifeSlider(8);
        document.getElementById('confirm-life-btn').onclick = () => this.confirmLifeAction();
        UI.openModal('life-modal');
        lucide.createIcons();
    },
    leaseProperty(id) {
        let prop = Game.config.properties.find(p => p.id === id);
        if (Engine.state.player.followers < prop.reqFans) {
            return UI.showAlert("Not Famous Enough", `Landlords for this tier of property run background checks. You need at least <span class="text-blue">${prop.reqFans.toLocaleString()} fans</span> before they will lease to you.`);
        }
        let totalStock = Object.values(Engine.state.inventory || {}).reduce((a, b) => a + b, 0);
        if (totalStock > prop.maxBoxes) {
            return UI.showAlert("Too Much Inventory", `You cannot downgrade to this property. You currently have ${totalStock.toLocaleString()} boxes of merch, but ${prop.title} can only hold ${prop.maxBoxes.toLocaleString()}. Sell your stock first!`);
        }
        UI.showConfirm("Sign New Lease", `Move into the ${prop.title}? This will take <span class="text-blue">6 Hours</span> and cost <span class="text-orange">30 Energy</span>. Your new rent will be <span class="text-red">$${prop.rent}</span> per month.`, async () => {
            if (Engine.state.player.energy < 30) return UI.showAlert("Energy Low", "You need at least <span class=\"text-orange\">30 Energy</span> to move all your gear.");
            await TimeManager.passTime(6, "Moving HQ");
            Engine.modifyStat('energy', -30);
            Engine.state.player.propertyId = id;
            Engine.log(`Moved HQ to: ${prop.title}`);
            UI.renderHQ(); 
            UI.updateVitals(); 
            UI.renderGear(); 
            UI.showAlert("Moved In!", `You successfully signed the lease for ${prop.title}. Make sure you can afford the rent!`);
        });
    },
    updateJobInfoDisplay() {
        let job = Game.config.jobs.find(j => j.id === Engine.state.player.jobId);
        document.getElementById('current-job-title').innerText = job.title;
        document.getElementById('current-job-desc').innerHTML = `<span class="text-green">$${job.wage}/h</span> <span class="text-muted">|</span> <span class="text-orange">-${job.energyDrain} Nrg</span> <span class="text-muted">|</span> <span class="text-red">+${job.stressGain} Stress</span>`;
    },
    openJobSelector() {
        let t = TimeManager.getCurrentTime();
        let cd = Engine.state.cooldowns?.jobChange || 0;
        if (t < cd) {
            let daysLeft = Math.ceil((cd - t) / 24);
            return UI.showAlert("Job Locked", `You recently signed a contract. Wait ${daysLeft} more days before switching jobs.`);
        }
        UI.closeModal('life-modal');
        const list = document.getElementById('job-list'); list.innerHTML = '';
        Game.config.jobs.forEach(job => {
            let locked = Engine.state.player.followers < job.reqFans;
            let btnClass = locked ? 'btn-outline disabled-btn' : 'btn-outline-purple';
            let btnText = locked ? `<i data-lucide="lock"></i> ${job.reqFans.toLocaleString()} Fans` : (Engine.state.player.jobId === job.id ? 'Current Job' : 'Take Job');
            list.innerHTML += `
               <div class="data-node flex-col" style="${Engine.state.player.jobId === job.id ? 'border-color: var(--accent-purple);' : ''}">
                    <div><strong>${job.title}</strong><br><span class="text-muted">${job.desc}</span></div>
                    <div style="font-family: var(--font-mono); font-size: 0.8rem; margin: 8px 0;">
                        <span class="text-green">$${job.wage}/h</span> | <span class="text-orange">-${job.energyDrain} NRG/h</span> | <span class="text-red">+${job.stressGain} STR/h</span>
                    </div>
                    <button class="${btnClass} w-100 mt-auto" ${locked || Engine.state.player.jobId === job.id ? 'disabled' : `onclick="PlayerActions.setJob('${job.id}')"`}>${btnText}</button>
                </div>
            `;
        });
        UI.openModal('job-modal'); lucide.createIcons();
    },
    setJob(jobId) {
        const job = Game.config.jobs.find(j => j.id === jobId);
        UI.showConfirm("Switch Career?", `Are you sure you want to become a ${job.title}? This will lock your employment for the next <span class="text-blue">7 days</span>.`, () => {
            Engine.state.player.jobId = jobId;
            Engine.state.cooldowns.jobChange = TimeManager.getCurrentTime() + 168;
            Engine.log(`Career Change: Now working as a ${job.title}.`);
            UI.closeModal('job-modal');
            this.openLifeModal('work');
            UI.updateVitals();
        });
    },
    confirmLifeAction() {
        const hours = parseInt(document.getElementById('life-hours-slider').value);
        UI.closeModal('life-modal');
        if (this.currentAction === 'sleep') {
            TimeManager.passTime(hours, "Sleeping"); 
            let rec = hours * 8; 
            if(Engine.state.player.perkId === 'sleeper') rec *= 1.2;
            Engine.modifyStat('energy', rec); 
            Engine.modifyStat('burnout', -(hours * 6)); 
            Engine.state.cooldowns.sleep = 12; 
        }
        else if (this.currentAction === 'pass') {
            const stressGain = hours * Game.config.settings.waitStressGainPerHour;
            TimeManager.passTime(hours, "Waiting");
            Engine.modifyStat('burnout', stressGain);
            Engine.log(`Passed ${hours}h. You feel a bit restless (+${stressGain}% Stress).`);
        }
        else {
            let job = Game.config.jobs.find(j => j.id === Engine.state.player.jobId);
            let reqNrg = hours * job.energyDrain;
            if(Engine.state.player.energy < reqNrg) return UI.showAlert("Energy Low", `You need ${reqNrg}% energy for this shift. Get some sleep.`);
            Engine.state.player.lastWorkDay = Engine.state.day;
            TimeManager.passTime(hours, `Job: ${job.title}`); 
            Engine.modifyStat('energy', -reqNrg); 
            Engine.modifyStat('burnout', hours * job.stressGain); 
            Engine.modifyStat('money', hours * job.wage); 
        }
    },
    marketingPush(id) {
        let rel = Engine.state.releases.find(r => r.id === id);
        if (!rel) return;
        let cost = 500;
        if (Engine.state.player.money < cost) return UI.showAlert("Insufficient Funds", "An Algorithmic Push costs <span class=\"text-red\">$500</span>.");
        UI.showConfirm("Algorithmic Push", `Spend <span class="text-red">$500</span> and <span class="text-blue">1 Hour</span> of setup time to run targeted ads for "${rel.title}"? This will boost its current momentum.`, async () => {
            await TimeManager.passTime(1, "Ad Campaign");
            Engine.modifyStat('money', -cost);
            rel.activeMultiplier *= 1.5;
            UI.renderReleases();
            Engine.log(`Ran Algorithmic Push for "${rel.title}".`);
            if (Engine.state.preferences && Engine.state.preferences.autosave) {
                Engine.saveGame(true);
            }
        });
    },
    openVisualsModal(id) {
        let rel = Engine.state.releases.find(r => r.id === id);
        if (!rel) return;
        document.getElementById('visual-modal-release-name').innerText = rel.title;
        const list = document.getElementById('visual-options-list');
        list.innerHTML = '';
        let currentVisIndex = Math.max(0, Game.config.visualOptions.findIndex(v => v.title === rel.visualName));
        Game.config.visualOptions.forEach((v, index) => {
            if (index <= currentVisIndex) return;
            let locked = Engine.state.player.followers < v.reqFans;
            let btnClass = locked ? 'btn-outline disabled-btn' : 'btn-outline-purple';
            let btnText = locked ? `<i data-lucide="lock"></i> ${v.reqFans.toLocaleString()} Fans` : `Shoot ($${v.cost.toLocaleString()})`;
            list.innerHTML += `
                <div class="data-node flex-col">
                    <div class="flex-row-between" style="align-items: flex-start;">
                        <div>
                            <strong style="font-size: 1.05rem;">${v.title}</strong><br>
                            <span class="text-muted" style="font-size: 0.8rem;">${v.desc}</span>
                        </div>
                       <span class="badge badge-outline"><span class="text-blue"><i data-lucide="clock"></i> 4h</span> <span style="opacity: 0.4; margin: 0 4px;">|</span> <span class="text-orange"><i data-lucide="zap"></i> 20 Nrg</span></span>
                    </div>
                    <div style="font-family: var(--font-mono); font-size: 0.8rem; margin: 12px 0;">
                        <span class="text-green">Base Hype Multiplier: ${v.hypeBoost}x</span>
                    </div>
                    <button class="${btnClass} w-100 mt-auto" ${locked ? 'disabled' : `onclick="PlayerActions.buyVisualUpgrade('${rel.id}', '${v.id}')"`}>${btnText}</button>
                </div>
            `;
        });
        UI.openModal('visual-modal');
        if(window.lucide) lucide.createIcons();
    },
    buyVisualUpgrade(relId, visId) {
        let rel = Engine.state.releases.find(r => r.id === relId);
        let newVis = Game.config.visualOptions.find(v => v.id === visId);
        let oldVis = Game.config.visualOptions.find(v => v.title === rel.visualName) || Game.config.visualOptions[0];
        if (!rel || !newVis) return;
        if (Engine.state.player.money < newVis.cost) return UI.showAlert("Insufficient Funds", `You need <span class="text-red">$${newVis.cost.toLocaleString()}</span> for this visual upgrade.`);
        if (Engine.state.player.energy < 20) return UI.showAlert("Energy Low", `Shooting a music video is exhausting. You need at least <span class="text-orange">20 Energy</span>.`);
        UI.showConfirm("Upgrade Visuals", `Spend <span class="text-red">$${newVis.cost.toLocaleString()}</span>, <span class="text-orange">20 Energy</span>, and <span class="text-blue">4 Hours</span> to shoot a ${newVis.title} for "${rel.title}"?`, async () => {
            UI.closeModal('visual-modal');
            await TimeManager.passTime(4, `Shooting ${newVis.title}`);
            Engine.modifyStat('money', -newVis.cost);
            Engine.modifyStat('energy', -20);
            rel.hypeRating = (rel.hypeRating / oldVis.hypeBoost) * newVis.hypeBoost;
            rel.activeMultiplier = Math.max(rel.activeMultiplier, 1.0) * 1.5; 
            rel.visualName = newVis.title;
            UI.renderReleases();
            UI.updateVitals();
            Engine.log(`Visuals upgraded: "${rel.title}" now has a ${newVis.title}.`);
            if (Engine.state.preferences && Engine.state.preferences.autosave) {
                Engine.saveGame(true);
            }
        });
    }
};

const MusicEngine = {
    startTrack() {
        let bpm = parseInt(document.getElementById('track-bpm').value) || 120;
        let titleInput = document.getElementById('track-title').value.trim();
        if(bpm < 60 || bpm > 200) return UI.showAlert("Invalid Input", "BPM must be between 60 and 200.");
        if(!titleInput) {
            Engine.state.player.untitledCount++;
            titleInput = `Untitled ${Engine.state.player.untitledCount}`;
        }
        if(Engine.state.tracks.some(t => t.title.toLowerCase() === titleInput.toLowerCase())) {
            return UI.showAlert("Duplicate Title", "You already have a session or master with this exact title. Choose another.");
        }
        let t = new Track(titleInput, document.getElementById('track-genre').value, bpm, document.getElementById('track-vibe').value);
        Engine.state.tracks.push(t); 
        UI.closeModal('track-modal'); 
        UI.renderStudio();
        Engine.log(`Started new studio session: "${t.title}".`);
    },
    deleteTrack(id) {
        UI.showConfirm("Scrap Session?", `Are you sure you want to scrap this session? All progress will be <span class="text-red">permanently lost</span>.`, () => {
            let track = Engine.state.tracks.find(t => t.id === id);
            if (track) {
                Engine.log(`Scrapped session: "${track.title}".`);
            }
            Engine.state.tracks = Engine.state.tracks.filter(t => t.id !== id);
            UI.renderStudio();
            if (Engine.state.preferences && Engine.state.preferences.autosave) {
                Engine.saveGame(true);
            }
        });
    },
    startSyncMinigame(trackTitle) {
        return new Promise((resolve) => {
            const overlay = document.getElementById('sync-minigame');
            const container = overlay.querySelector('.sync-container');
            const indicator = document.getElementById('sync-indicator');
            const target = document.getElementById('sync-target');
            const resultEl = document.getElementById('sync-result');
            const trackNameEl = document.getElementById('sync-track-name');
            const bar = overlay.querySelector('.sync-bar');
            container.classList.remove('success', 'fail');
            resultEl.innerText = '';
            trackNameEl.innerText = trackTitle ? `// ${trackTitle.toUpperCase()}` : '';
            overlay.classList.add('active');
            requestAnimationFrame(() => {
                const barWidth = bar.offsetWidth;
                const targetWidth = 45; 
                target.style.width = targetWidth + 'px';
                const minLeft = Math.floor(barWidth * 0.1);
                const maxLeft = Math.floor(barWidth * 0.85) - targetWidth;
                const targetLeft = Math.floor(Math.random() * (maxLeft - minLeft)) + minLeft;
                target.style.left = targetLeft + 'px';
                let pos = 0;
                let speed = 4.5 + (Math.random() * 2); 
                let animFrame;
                let done = false;
                function animate() {
                    pos += speed;
                    if (pos >= barWidth - 6 || pos <= 0) speed *= -1;
                    indicator.style.left = pos + 'px';
                    animFrame = requestAnimationFrame(animate);
                }
                animFrame = requestAnimationFrame(animate);
                function finish() {
                    if (done) return;
                    done = true;
                    cancelAnimationFrame(animFrame);
                    document.removeEventListener('keydown', onKey);
                    overlay.removeEventListener('click', finish);
                    const success = pos >= targetLeft && pos <= targetLeft + targetWidth - 6;
                    container.classList.add(success ? 'success' : 'fail');
                    resultEl.innerText = success ? '✓ PERFECT SYNC' : '✗ MISSED';
                    setTimeout(() => {
                        container.classList.remove('success', 'fail');
                        setTimeout(() => { overlay.classList.remove('active'); resolve(success); }, 300);
                    }, 600);
                }
                function onKey(e) { if (e.code === 'Space') { e.preventDefault(); finish(); } }
                document.addEventListener('keydown', onKey);
                overlay.addEventListener('pointerdown', finish);
            });
        });
    },
    async workOnTrack(id, hours) {
        let nrgCost = hours * Game.config.settings.studioEnergyCostPerHour; 
        if(Engine.state.player.energy < nrgCost) return UI.showAlert("Energy Low", "You don't have enough energy for this session.");
        let track = Engine.state.tracks.find(t => t.id === id);
        await UI.runCountdown();
        const success = await this.startSyncMinigame(track.title);
        await TimeManager.passTime(hours, `Studio: ${track.title}`);
        Engine.modifyStat('energy', -nrgCost); 
        Engine.modifyStat('burnout', hours * Game.config.settings.studioStressGainPerHour); 
        let statusMult = Engine.getMultiplier('studioMult');
        let multiplier = (success ? 1.4 : 0.7) * statusMult; 
        track.progress += hours * Game.config.settings.studioProgressPerHour * statusMult; 
        let statCap = track.currentStage === 'Writing' ? Engine.state.player.caps.writing : (track.currentStage === 'Recording' ? Engine.state.player.caps.recording : Engine.state.player.caps.mixing);
        let gearScale = Math.max(1.0, statCap / 15); 
        let baseGain = Math.floor((Math.random() * 1.5 + 0.5) * hours * 2.5 * multiplier * gearScale);
        let applyCap = (current, gain, capLimit, statName) => {
            let actualGain = gain;
            if(statName === 'Writing' && Engine.state.player.perkId === 'writer') actualGain *= 1.25;
            if(statName === 'Mixing' && Engine.state.player.perkId === 'mixer') actualGain *= 1.25;
            let maxGain = capLimit - current;
            if (maxGain <= 0) return 0;
            return Math.min(actualGain, maxGain);
        };
        if(track.currentStage === 'Writing') track.lyrics += applyCap(track.lyrics, baseGain, Engine.state.player.caps.writing, 'Writing');
        else if(track.currentStage === 'Recording') track.prod += applyCap(track.prod, baseGain, Engine.state.player.caps.recording, 'Recording');
        else if(track.currentStage === 'Mixing') track.mix += applyCap(track.mix, baseGain, Engine.state.player.caps.mixing, 'Mixing');
        if (track.progress >= 100) {
            track.progress = 0; 
            track.currentStageIndex++;
            if (track.currentStageIndex >= track.stages.length) { 
                track.status = 'Ready'; 
                Engine.log(`Track "${track.title}" finished and exported to vault.`);
                UI.renderVault(); 
                ChallengeEngine.trigger('finish_track', track);
                ChallengeEngine.trigger('quality_track', track);
            }
        }
        const resultTitle = success ? "Session Successful" : "Session Failed";
        const resultMsg = success ? `Great vibe! You hit the sync and gained a quality boost.` : `You were off-beat. Session suffered a penalty and drained extra energy.`;
        UI.showAlert(resultTitle, resultMsg);
        UI.renderStudio(); UI.updateVitals();
    }
};

const MarketEngine = {
    buyGear(id) {
        let g = Game.config.gear.find(x => x.id === id);
        if (Engine.state.player.money < g.cost) return UI.showAlert("Insufficient Funds", "You don't have enough money for this upgrade.");
        if (Engine.state.player.followers < g.reqFans) return UI.showAlert("Not Famous Enough", `You need <span class="text-blue">${g.reqFans.toLocaleString()} fans</span> before you can access this gear.`);
        UI.showConfirm("Buy Equipment", `Purchase ${g.name} for <span class="text-red">$${g.cost.toLocaleString()}</span>?`, () => {
            Engine.modifyStat('money', -g.cost); g.owned = true;
            Engine.state.player.caps[g.capType] += g.capIncrease;
            Engine.log(`Purchased Studio Gear: ${g.name}`);
            UI.renderGear(); UI.renderStudio(); 
        });
    },
    hireService(type) {
        let srv = Game.config.services.find(s => s.id === type);
        let active = Engine.state.tracks.filter(t => t.status === 'In Progress');
        if(active.length === 0) return UI.showAlert("No Active Sessions", "You must have at least one active studio session to hire a professional.");
        if (Engine.state.player.money < srv.cost) return UI.showAlert("Insufficient Funds", `You need <span class="text-red">$${srv.cost.toLocaleString()}</span> to hire this professional.`);
        document.getElementById('service-modal-title').innerHTML = `<i data-lucide="${srv.icon}"></i> Hire ${srv.title}`;
        document.getElementById('service-modal-desc').innerHTML = `Select the session to apply this <span class="text-red">$${srv.cost.toLocaleString()}</span> service to. Coordinating this will take <span class="text-blue">2 Hours</span>.`;
        let sel = document.getElementById('service-target-select');
        sel.innerHTML = active.map(t => `<option value="${t.id}">${t.title}</option>`).join('');
        document.getElementById('confirm-service-btn').onclick = async () => {
            UI.closeModal('service-modal');
            let track = Engine.state.tracks.find(t => t.id === sel.value);
            await TimeManager.passTime(2, `Hiring ${srv.title}`);
            Engine.modifyStat('money', -srv.cost); 
            Engine.log(`Hired ${srv.title} for session "${track.title}".`);
            if(srv.capType === 'writing') track.lyrics = Math.min(Engine.state.player.caps.writing, track.lyrics + srv.boost); 
            else if(srv.capType === 'recording') track.prod = Math.min(Engine.state.player.caps.recording, track.prod + srv.boost); 
            else if(srv.capType === 'mixing') track.mix = Math.min(Engine.state.player.caps.mixing, track.mix + srv.boost); 
            UI.renderStudio();
        };
        UI.openModal('service-modal');
        lucide.createIcons();
    }
};

const MerchEngine = {
    buyBatch(id) {
        let item = Game.config.merch.find(m => m.id === id);
        if (!item) return;
        let releaseId = null;
        if (item.category === 'physical') {
            let selectEl = document.getElementById(`select-rel-${id}`);
            if (!selectEl || !selectEl.value) return UI.showAlert("Missing Selection", "You must select a Live Album or EP to press physicals for.");
            releaseId = selectEl.value;
        }
        if (Engine.state.player.followers < item.reqFans) return UI.showAlert("Not Famous Enough", `You need ${item.reqFans.toLocaleString()} fans to press this.`);
        if (Engine.state.player.money < item.costPerBatch) return UI.showAlert("Insufficient Funds", `You need $${item.costPerBatch.toLocaleString()} upfront.`);
        UI.showConfirm("Order Inventory", `Spend <span class="text-red">$${item.costPerBatch.toLocaleString()}</span> to manufacture ${item.batchSize} units?`, () => {
            Engine.modifyStat('money', -item.costPerBatch);
            let inventoryKey = releaseId ? `${id}|${releaseId}` : id;
            Engine.state.inventory[inventoryKey] = (Engine.state.inventory[inventoryKey] || 0) + item.batchSize;
            let relName = releaseId ? Engine.state.releases.find(r => r.id === releaseId)?.title : "Global Brand";
            Engine.log(`Ordered ${item.batchSize}x ${item.title} for [${relName}].`);
            if (UI.renderMerch) UI.renderMerch(); 
            UI.updateVitals();
        });
    }
};

const EntourageEngine = {
    hireStaff(id) {
        let s = Game.config.staff.find(x => x.id === id);
        if (Engine.state.player.money < s.cost) return UI.showAlert("Insufficient Funds", "You can't afford their upfront signing bonus.");
        UI.showConfirm("Hire Staff", `Pay <span class="text-red">$${s.cost.toLocaleString()}</span> signing bonus and add them to your payroll at <span class="text-red">$${s.wage}/day</span>?`, () => {
             Engine.modifyStat('money', -s.cost);
             Engine.state.staff.push(s.id);
             UI.renderHQ();
             UI.updateVitals();
             UI.renderPromos();
             UI.renderContracts();
             UI.renderStudio();
             if (UI.renderMerch) UI.renderMerch();
             Engine.log(`Hired ${s.title}. Added to payroll.`);
        });
    }
};

const SocialEngine = {
    async postContent(tier) {
        let cost = tier==='low'?15 : (tier==='med'?30:55);
        if (Engine.state.player.energy < cost) return UI.showAlert("Energy Low", "You don't have enough energy to produce content.");
        await TimeManager.passTime(tier==='low'?1 : (tier==='med'?2:4), "Content Creation");
        Engine.modifyStat('energy', -cost);
        let variance = Math.random() * 0.8 + 0.6; 
        let gain = Math.floor(variance * (cost * 6)) + cost; 
        if(Engine.state.player.perkId === 'social') gain = Math.floor(gain * 1.2);
        Engine.modifyStat('followers', gain);
        if(tier !== 'low') Engine.modifyStat('hype', tier==='med'?0.15:0.5);
    },
    buyPromo(id) {
        let promo = Game.config.promos.find(p => p.id === id);
        if(!promo) return;
        if (Engine.state.player.money < promo.cost) return UI.showAlert("Insufficient Funds", "You can't afford this promotion campaign.");
        UI.showConfirm("Purchase Promo", `Run this campaign for <span class="text-red">$${promo.cost.toLocaleString()}</span>? Setup will take <span class="text-blue">2 Hours</span>.`, async () => {
            await TimeManager.passTime(2, "Marketing Setup");
            Engine.modifyStat('money', -promo.cost);
            let pMult = Engine.state.player.perkId === 'social' ? 1.2 : 1.0;
            let prMult = Engine.state.staff.includes('staff_pr') ? 1.25 : 1.0; 
            let fansGain = Math.floor((Math.random() * (promo.fansMax - promo.fansMin)) + promo.fansMin) * pMult * prMult;
            Engine.modifyStat('followers', fansGain);
            Engine.modifyStat('hype', promo.hype);
            Engine.log(`Promo Campaign [${promo.title}] completed. +${fansGain.toLocaleString()} Fans.`);
        });
    }
};

const DistroEngine = {
    currentDistro: 'sc', 
    selectDistro(type) {
        let opt = Game.config.distroOptions.find(d => d.id === type);
        if (opt.reqFans > Engine.state.player.followers) return;
        this.currentDistro = type;
        UI.renderDistroOptions(); 
    },
    addTrackToPending() {
        let sel = document.getElementById('vault-selector');
        let id = sel.value; if(!id) return;
        let track = Engine.state.tracks.find(t => t.id === id);
        if(!Engine.pendingTracklist.find(t => t.id === id)) {
            Engine.pendingTracklist.push(track);
            this.renderPendingTracklist();
        }
        sel.value = "";
        sel.dispatchEvent(new Event('change'));
    },
    moveTrack(index, dir) {
        if(index + dir < 0 || index + dir >= Engine.pendingTracklist.length) return;
        let temp = Engine.pendingTracklist[index];
        Engine.pendingTracklist[index] = Engine.pendingTracklist[index + dir];
        Engine.pendingTracklist[index + dir] = temp;
        this.renderPendingTracklist();
    },
    removeTrack(index) {
        Engine.pendingTracklist.splice(index, 1);
        this.renderPendingTracklist();
    },
    renderPendingTracklist() {
        let list = document.getElementById('pending-tracklist');
        if(Engine.pendingTracklist.length === 0) {
            list.innerHTML = `<div class="empty-state" style="padding:20px; font-size: 0.8rem;"><i data-lucide="music" style="width:24px;height:24px;"></i><span>No tracks selected.</span></div>`;
            lucide.createIcons(); return;
        }
        let html = '';
        Engine.pendingTracklist.forEach((t, i) => {
            html += `
                <div class="track-list-item">
                    <div>
                        <strong>${i+1}. ${t.title}</strong><br>
                        <div class="flex-row gap-10" style="margin-top: 6px;">
                            <span class="badge badge-purple">Qual: ${t.quality}</span>
                            <span class="badge badge-outline">DSP Count: ${t.dspReleaseCount}</span>
                        </div>
                    </div>
                    <div class="track-list-actions">
                        <button class="btn-icon" onclick="DistroEngine.moveTrack(${i}, -1)"><i data-lucide="chevron-up"></i></button>
                        <button class="btn-icon" onclick="DistroEngine.moveTrack(${i}, 1)"><i data-lucide="chevron-down"></i></button>
                        <button class="btn-icon text-red" onclick="DistroEngine.removeTrack(${i})" style="margin-top: 0;"><i data-lucide="x"></i></button>
                    </div>
                </div>`;
        });
        list.innerHTML = html;
        lucide.createIcons();
    },
    submitRelease() {
        let title = document.getElementById('rel-title').value.trim() || "Untitled Release";
        let formatStr = document.getElementById('rel-format').value;
        let visualStr = document.getElementById('rel-visuals').value;
        let dspVal = this.currentDistro;
        if(Engine.pendingTracklist.length === 0) return UI.showAlert("No Tracks Selected", "Please select at least one track for release.");
        let formatObj = Game.config.releaseFormats.find(f => f.id === formatStr);
        let distroObj = Game.config.distroOptions.find(d => d.id === dspVal);
        let visualObj = Game.config.visualOptions.find(v => v.id === visualStr);
        if(Engine.pendingTracklist.length < formatObj.min || Engine.pendingTracklist.length > formatObj.max) {
            return UI.showAlert("Invalid Track Count", `A ${formatObj.title} requires ${formatObj.min}-${formatObj.max} tracks.`);
        }
        let totalCost = distroObj.cost + visualObj.cost;
        if(Engine.state.player.money < totalCost) return UI.showAlert("Insufficient Funds", "You don't have enough money for this distribution tier and visual budget.");
        UI.showConfirm("Deploy Release", `Package "${title}" and sign off distribution? (Cost: <span class="text-red">$${totalCost.toLocaleString()}</span>)`, () => {
            Engine.modifyStat('money', -totalCost);
            let platforms = ['sc']; 
            if(dspVal !== 'sc') platforms.push('dsp');
            let dropDay = Engine.state.day + distroObj.delay;
            let rel = new Release(title, formatObj.id, [...Engine.pendingTracklist], Engine.artBuffer, platforms, dspVal, dropDay, visualObj.hypeBoost, visualObj.title);
            Engine.state.releases.push(rel);
            Engine.log(`Scheduled Release: "${title}" packaged and sent to distro.`);
            ChallengeEngine.trigger('release_format', rel);
            Engine.pendingTracklist = [];
            UI.closeModal('release-modal');
            UI.renderReleases();
            UI.showAlert("Release Deployed", `"${title}" has been packaged and queued for distribution. It goes live on Day ${dropDay}.`);
        });
    }
};

const UI = {
    populateDropdowns() {
        const perkSel = document.getElementById('player-perk'); perkSel.innerHTML = '';
        Game.config.perks.forEach(p => perkSel.innerHTML += `<option value="${p.id}">${p.title} (${p.desc})</option>`);
        const jobSel = document.getElementById('player-job'); jobSel.innerHTML = '';
        Game.config.jobs.filter(j => j.reqFans === 0).forEach(j => jobSel.innerHTML += `<option value="${j.id}">${j.title} ($${j.wage}/h | ${j.desc})</option>`);
        const genreSel = document.getElementById('track-genre'); genreSel.innerHTML = '';
        Game.config.settings.genres.forEach(g => genreSel.innerHTML += `<option value="${g}">${g}</option>`);
        const vibeSel = document.getElementById('track-vibe'); vibeSel.innerHTML = '';
        Game.config.settings.moods.forEach(v => vibeSel.innerHTML += `<option value="${v}">${v}</option>`);
    },
    renderServices() {
        const categories = ['writing', 'recording', 'mixing'];
        const colorMap = { writing: 'orange', recording: 'green', mixing: 'blue' };
        const iconMap = { writing: 'pen-tool', recording: 'mic', mixing: 'sliders' };
        if(!Game.config.services) return;
        
        categories.forEach(cat => {
            let container = document.getElementById(`pros-list-${cat}`);
            if (!container) return;
            let badgeColor = colorMap[cat];
            let icon = iconMap[cat];
            
            // On réintègre le titre de la catégorie avec grid-span-full pour qu'il prenne toute la largeur !
            container.innerHTML = `<div class="shop-category-header grid-span-full" style="--accent-color: var(--accent-${badgeColor});"><i data-lucide="${icon}" class="text-${badgeColor}"></i><span>${cat.toUpperCase()}</span></div>`;
            
            Game.config.services.filter(s => s.capType === cat).forEach(s => {
                container.innerHTML += `
                <div class="data-node flex-col">
                  <div style="margin-bottom: 15px;">
                    <strong style="font-size: 1.05rem;">${s.title}</strong><br>
                    <span class="text-muted" style="display: block; margin-top: 8px;">${s.desc}</span>
                  </div>
                  <button class="btn-outline-${s.color} w-100 mt-auto" onclick="MarketEngine.hireService('${s.id}')">Hire ($${s.cost.toLocaleString()})</button>
                </div>`;
            });
        });
        if(window.lucide) lucide.createIcons();
    },
    renderDistroOptions() {
        const list = document.getElementById('distro-options-list'); 
        list.innerHTML = `<h4 style="font-size: 0.8rem; text-transform: uppercase; color: var(--text-muted); letter-spacing: 1px; margin-bottom: 5px;">Distribution Plan</h4>`;
        Game.config.distroOptions.forEach(d => {
            let locked = Engine.state.player.followers < d.reqFans;
            let classes = `distro-option ${DistroEngine.currentDistro === d.id ? 'selected' : ''} ${locked ? 'locked' : ''}`;
            list.innerHTML += `
            <div id="distro-opt-${d.id}" class="${classes}" onclick="DistroEngine.selectDistro('${d.id}')">
                <div class="flex-row-between"><strong>${d.title}</strong> <span class="badge badge-${d.badgeColor}">${d.badge}</span></div>
                <span class="text-muted" style="font-size: 0.75rem; margin-top: 4px; display: block;">${d.desc} ${locked ? `<i data-lucide="lock" style="width:10px;"></i> Req: ${d.reqFans.toLocaleString()} Fans` : ''}</span>
            </div>`;
        });
        lucide.createIcons();
    },
    renderStatuses() {
        const tray = document.getElementById('status-tray');
        if(!tray) return;
        let html = '';
        if (Engine.state.player.statuses && Engine.state.player.statuses.length > 0) {
            Engine.state.player.statuses.forEach(s => {
                let sConf = Game.config.statuses[s.id];
                if(!sConf) return;
                html += `
                <div class="status-icon" style="border-bottom: 3px solid var(--accent-${sConf.color});">
                    <i data-lucide="${sConf.icon}" class="text-${sConf.color}"></i>
                    <div class="status-tooltip">
                        <div style="font-weight: 800; font-size: 0.9rem; margin-bottom: 6px; text-transform: uppercase;" class="text-${sConf.color}">
                            ${sConf.name}
                        </div>
                        <div style="color: var(--text-main); margin-bottom: 12px; font-size: 0.8rem; line-height: 1.4;">
                            ${sConf.desc}
                        </div>
                        <div class="text-muted flex-row gap-10" style="font-family: var(--font-mono); font-size: 0.75rem; border-top: 1px dashed rgba(255,255,255,0.1); padding-top: 8px;">
                            <i data-lucide="clock"></i> ${s.hoursLeft}H REMAINING
                        </div>
                    </div>
                </div>`;
            });
        }
        if (Engine.state.player.challenges && Engine.state.player.challenges.length > 0) {
            Engine.state.player.challenges.forEach(c => {
                let daysLeft = c.deadline - Engine.state.day;
                html += `
                <div class="status-icon" style="border-bottom: 3px solid var(--accent-orange);">
                    <i data-lucide="target" class="text-orange"></i>
                    <div class="status-tooltip">
                        <div style="font-weight: 800; font-size: 0.9rem; margin-bottom: 6px; text-transform: uppercase;" class="text-orange">
                            CONTRACT: ${c.title}
                        </div>
                        <div style="color: var(--text-main); margin-bottom: 12px; font-size: 0.8rem; line-height: 1.4;">
                            ${c.desc}<br>
                            <span class="text-green">Reward: $${c.reward}</span> | <span class="text-red">Fail: -$${c.penalty}</span>
                        </div>
                        <div class="text-muted flex-row gap-10" style="font-family: var(--font-mono); font-size: 0.75rem; border-top: 1px dashed rgba(255,255,255,0.1); padding-top: 8px;">
                            <i data-lucide="clock"></i> ${daysLeft} DAYS REMAINING
                        </div>
                    </div>
                </div>`;
            });
        }
        tray.innerHTML = html;
        if(window.lucide) lucide.createIcons();
    },
    renderContracts() {
        const board = document.getElementById('contract-board');
        if(!board) return;
        const desc = document.getElementById('contract-board-desc');
        if (desc) {
            let costText = `<span>(Costs: <span class="text-orange">15 Energy</span> / <span class="text-blue">2 Hours</span>)</span>`;
            if (Engine.state.staff.includes('staff_manager')) {
                desc.innerHTML = `<span class="text-green" style="display: inline-flex; align-items: center; gap: 6px; margin-bottom: 4px;"><i data-lucide="briefcase" style="width:14px; height:14px;"></i> Your Booking Manager is automatically hustling for leads.</span><br>You can also manually network below. ${costText}`;
            } else {
                desc.innerHTML = `Sign industry contracts to earn cash injections. Missing deadlines incurs heavy penalties. Network manually to find leads. ${costText}`;
            }
        }
        if(Engine.state.availableContracts.length === 0) {
            board.innerHTML = `<div class="empty-state" style="min-height: 80px;"><i data-lucide="inbox"></i><span>No active leads. Network to find some.</span></div>`;
            if(window.lucide) lucide.createIcons();
            return;
        }
        let html = '';
        Engine.state.availableContracts.forEach(c => {
            html += `
            <div class="data-node flex-row-between" style="padding: 15px; align-items: center;">
                <div style="flex: 1;">
                    <strong style="font-size: 1.05rem;">${c.title}</strong><br>
                    <span class="text-muted" style="font-size: 0.8rem;">${c.desc}</span>
                </div>
                <div style="text-align: right; margin-right: 15px; font-family: var(--font-mono); font-size: 0.85rem;">
                    <div class="text-green">+$${c.reward}</div>
                    <div class="text-red">-$${c.penalty}</div>
                </div>
                <button class="btn-outline-purple" onclick="ChallengeEngine.openContractModal('${c.instanceId}')">Review</button>
            </div>`;
        });
        board.innerHTML = html;
        if(window.lucide) lucide.createIcons();
    },
    renderPromos() {
        const list = document.getElementById('promo-list');
        if (!list) return;
        list.innerHTML = '';
        if (Engine.state.staff.includes('staff_pr')) {
            list.innerHTML += `
                <div class="staff-banner banner-blue grid-span-full">
                    <i data-lucide="megaphone"></i>
                    <span><strong>Publicist Active:</strong> Hype decay is halved and promo gains are boosted by 25%.</span>
                </div>`;
        }
        const money = Engine.state.player.money;
        const followers = Engine.state.player.followers;
        const runnable = Game.config.promos.filter(p => followers >= p.reqFans && money >= p.cost);
        const bestValueId = runnable.length > 0
            ? runnable.reduce((best, p) => (p.hype / p.cost) > (best.hype / best.cost) ? p : best).id
            : null;
        const colorRgb = { green: '11,232,129', purple: '176,91,255', yellow: '255,211,42', blue: '75,207,250', orange: '255,168,1', red: '255,94,87' };
        Game.config.promos.forEach(p => {
            const fanLocked  = followers < p.reqFans;
            const cantAfford = !fanLocked && money < p.cost;
            const available  = !fanLocked && !cantAfford;
            let btnClass, btnContent;
            if (fanLocked) {
                btnClass   = 'btn-outline disabled-btn';
                btnContent = `<i data-lucide="lock"></i> ${p.reqFans.toLocaleString()} Fans`;
            } else if (cantAfford) {
                btnClass   = 'btn-outline-red disabled-btn';
                btnContent = `<i data-lucide="dollar-sign"></i> Need $${(p.cost - money).toFixed(0)} More`;
            } else {
                btnClass   = `btn-outline-${p.color}`;
                btnContent = `Purchase ($${p.cost})`;
            }
            const rgb         = colorRgb[p.color] || '255,255,255';
            const borderStyle = available ? `border-color: rgba(${rgb}, 0.35);` : '';
            list.innerHTML += `
            <div class="data-node flex-col" style="${borderStyle}">
              <div>
                  <strong>${p.title}</strong><br>
                  <div style="font-family: var(--font-mono); font-size: 0.8rem; margin: 8px 0;">
                      <span class="text-red">-$${p.cost}</span> | <span class="text-${p.color}">${p.desc}</span>
                  </div>
              </div>
              <button id="promo-btn-${p.id}" class="${btnClass} w-100 mt-auto" style="margin-top:15px;" ${available ? `onclick="SocialEngine.buyPromo('${p.id}')"` : 'disabled'}>${btnContent}</button>
            </div>`;
        });
        if(window.lucide) lucide.createIcons();
    },
    renderSettings() {
        const btn = document.getElementById('btn-toggle-autosave');
        if(!btn) return;
        if(Engine.state.preferences && Engine.state.preferences.autosave) {
            btn.className = 'btn-outline-green w-100';
            btn.innerHTML = '<i data-lucide="check-circle"></i> Autosave: ON';
        } else {
            btn.className = 'btn-outline-red w-100';
            btn.innerHTML = '<i data-lucide="x-circle"></i> Autosave: OFF';
        }
        if(window.lucide) lucide.createIcons();
    },
    toggleAutosave() {
        Engine.state.preferences.autosave = !Engine.state.preferences.autosave;
        this.renderSettings();
        Engine.saveGame(true); 
    },
    switchTab(tabId) {
        document.querySelectorAll('.tab-content, .nav-btn').forEach(el => el.classList.remove('active'));
        document.getElementById(`tab-${tabId}`).classList.add('active');
        document.querySelector(`.nav-btn[onclick="UI.switchTab('${tabId}')"]`).classList.add('active');
        document.body.classList.remove('menu-open');
        if(tabId === 'dashboard' && Engine.chart) Engine.chart.resize();
    },
    async runCountdown() {
        const blocker = document.getElementById('action-blocker');
        const text = document.getElementById('blocker-text');
        blocker.classList.remove('hidden');
        await new Promise(r => requestAnimationFrame(r));
        blocker.classList.add('active');
        const steps = ['3', '2', '1', 'GO!'];
        for (let step of steps) {
            text.innerText = step;
            await new Promise(r => setTimeout(r, 600)); 
        }
        blocker.classList.remove('active');
        setTimeout(() => blocker.classList.add('hidden'), 300); 
    },
    openPassTimeModal() {
        PlayerActions.currentAction = 'pass';
        const slider = document.getElementById('life-hours-slider');
        slider.value = 1;
        document.getElementById('life-modal-title').innerHTML = `<i data-lucide="clock"></i> Kill Time`;
        document.getElementById('confirm-life-btn').innerText = "WAIT";
        document.getElementById('job-info-box').style.display = 'none';
        this.updateLifeSlider(1);
        document.getElementById('confirm-life-btn').onclick = () => PlayerActions.confirmLifeAction();
        this.openModal('life-modal');
        lucide.createIcons();
    },
    initCustomSelects() {
        document.querySelectorAll('.custom-options.body-appended').forEach(el => {
            if (el.dataset.linkedSelect && !document.getElementById(el.dataset.linkedSelect)) {
                el.remove();
            }
        });
        document.querySelectorAll('select').forEach(select => {
            if (select.dataset.customized) return;
            select.dataset.customized = "true";
            if (!select.id) select.id = 'sel_' + Math.random().toString(36).substr(2, 9);
            if (select.nextElementSibling && select.nextElementSibling.classList.contains('custom-select-container')) {
                select.nextElementSibling.remove();
            }
            select.style.display = 'none'; 
            const container = document.createElement('div');
            container.className = 'custom-select-container';
            const trigger = document.createElement('div');
            trigger.className = 'custom-select-trigger';
            const optionsContainer = document.createElement('div');
            optionsContainer.className = 'custom-options body-appended';
            optionsContainer.dataset.linkedSelect = select.id; 
            document.body.appendChild(optionsContainer);
            container.appendChild(trigger);
            select.parentNode.insertBefore(container, select.nextSibling);
            const render = () => {
                optionsContainer.innerHTML = '';
                let selectedText = "Select...";
                if (select.options.length > 0 && select.selectedIndex >= 0) {
                    selectedText = select.options[select.selectedIndex].innerText; 
                }
                trigger.innerHTML = `<span style="flex-grow: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${selectedText}</span><i data-lucide="chevron-down" style="flex-shrink: 0; width: 18px;"></i>`;
                Array.from(select.options).forEach((option, index) => {
                    const optDiv = document.createElement('div');
                    optDiv.className = 'custom-option' + (option.disabled ? ' disabled' : '') + (option.selected ? ' selected' : '');
                    optDiv.innerText = option.innerText;
                    optDiv.addEventListener('click', (e) => {
                        e.stopPropagation();
                        if (option.disabled) return;
                        select.selectedIndex = index;
                        select.dispatchEvent(new Event('change')); 
                        render();
                        optionsContainer.classList.remove('open');
                        if (window.lucide) lucide.createIcons();
                    });
                    optionsContainer.appendChild(optDiv);
                });
                if (window.lucide) lucide.createIcons();
            };
            render();
            select.addEventListener('change', render);
            const observer = new MutationObserver(render);
            observer.observe(select, { childList: true, subtree: true });
            trigger.addEventListener('click', (e) => {
                e.stopPropagation();
                const isOpen = optionsContainer.classList.contains('open');
                document.querySelectorAll('.custom-options').forEach(c => c.classList.remove('open'));
                if (!isOpen) {
                    const rect = trigger.getBoundingClientRect();
                    optionsContainer.style.top = (rect.bottom + window.scrollY + 8) + 'px';
                    optionsContainer.style.left = (rect.left + window.scrollX) + 'px';
                    optionsContainer.style.width = rect.width + 'px';
                    optionsContainer.classList.add('open');
                }
            });
        });
        if (!this.dropdownListenersAttached) {
            document.addEventListener('click', () => document.querySelectorAll('.custom-options').forEach(c => c.classList.remove('open')));
            document.addEventListener('scroll', (e) => {
                if (e.target.classList && e.target.classList.contains('custom-options')) return;
                document.querySelectorAll('.custom-options').forEach(c => c.classList.remove('open'));
            }, true);
            this.dropdownListenersAttached = true;
        }
    },
    openModal(id) { 
        const el = document.getElementById(id);
        el.classList.remove('hidden'); 
        void el.offsetWidth;
        el.classList.add('active-overlay');
    },
    closeModal(id) { 
        
        if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA' || document.activeElement.tagName === 'SELECT')) {
            document.activeElement.blur();
        }
        
        
        setTimeout(() => {
            window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
            document.body.scrollTop = 0;
        }, 50);

        const el = document.getElementById(id);
        el.classList.remove('active-overlay');
        setTimeout(() => el.classList.add('hidden'), 300); 
    },
    updateClock() {
        document.getElementById('clock-display').innerHTML = `DAY ${Engine.state.day}<br>${Engine.state.hour.toString().padStart(2, '0')}:00`;
        document.getElementById('day-progress').style.width = `${(Engine.state.hour / 24) * 100}%`;
    },
    updateVitals() {
        document.getElementById('vitals-money').innerText = `$${Engine.state.player.money.toFixed(2)}`;
        let currentProp = Game.config.properties.find(p => p.id === Engine.state.player.propertyId);
        let rentCost = currentProp ? currentProp.rent : 0;
        let rentInterval = Game.config.settings.rentIntervalDays;
        let nextRentDay = Math.ceil(Engine.state.day / rentInterval) * rentInterval;
        if (nextRentDay === Engine.state.day) nextRentDay += rentInterval; 
        let daysUntilRent = nextRentDay - Engine.state.day;
        let rentDisplay = document.getElementById('rent-countdown');
        rentDisplay.innerText = `-$${rentCost} IN ${daysUntilRent}D`;
        if (daysUntilRent <= 3) rentDisplay.className = 'text-red';
        else if (daysUntilRent <= 7) rentDisplay.className = 'text-yellow';
        else rentDisplay.className = 'text-muted';
        const energy = Engine.state.player.energy;
        const eEl = document.getElementById('vitals-energy-text');
        const eBar = document.getElementById('vitals-energy-bar');
        eEl.innerText = `${Math.floor(energy)}%`;
        eBar.style.width = `${energy}%`;
        eBar.className = `stat-bar-fill ${energy > 60 ? 'bg-green' : (energy > 30 ? 'bg-yellow' : 'bg-red')}`;
        const burnout = Engine.state.player.burnout;
        const bEl = document.getElementById('vitals-burnout-text');
        const bBar = document.getElementById('vitals-burnout-bar');
        bEl.innerText = `${Math.floor(burnout)}%`;
        bBar.style.width = `${burnout}%`;
        bBar.className = `stat-bar-fill ${burnout < 30 ? 'bg-green' : (burnout < 60 ? 'bg-yellow' : 'bg-red')}`;
        document.getElementById('dash-followers').innerText = Engine.state.player.followers.toLocaleString();
        document.getElementById('dash-hype').innerText = Engine.state.player.hype.toFixed(2);
        document.getElementById('profile-name').innerText = Engine.state.player.name;
        document.getElementById('trend-display').innerText = `${Engine.state.trend.genre} | ${Engine.state.trend.mood} | ~${Engine.state.trend.bpmBase} BPM`;
        const traitObj = Game.config.perks.find(p => p.id === Engine.state.player.perkId);
        if(traitObj) document.getElementById('profile-perk-display').innerHTML = `<i data-lucide="zap" style="width:12px;"></i> Trait: ${traitObj.title}`;
        document.getElementById('profile-bio').value = Engine.state.player.bio;
        if(Engine.state.player.avatar) document.getElementById('profile-avatar').src = Engine.state.player.avatar;
        let liveReleases = Engine.state.releases.filter(r => r.status === 'Live');
        let latest = liveReleases.length > 0 ? liveReleases[liveReleases.length - 1].title : "None";
        document.getElementById('dash-latest-drop').innerText = latest;
        const sBtn = document.getElementById('btn-action-sleep');
        const wBtn = document.getElementById('btn-action-work');
        const sleepCD = Engine.state.cooldowns.sleep || 0;
        const isExhausted = energy < 30;
        if (sleepCD > 0 && !isExhausted) {
            sBtn.classList.add('disabled-btn');
            sBtn.innerHTML = `<i data-lucide="clock"></i> Rest in ${sleepCD}h`;
            sBtn.onclick = null;
        } else {
            sBtn.classList.remove('disabled-btn');
            sBtn.innerHTML = `<i data-lucide="bed"></i> Sleep`;
            sBtn.onclick = () => PlayerActions.openLifeModal('sleep');
        }
        if (Engine.state.player.jobId === 'fulltime') {
            wBtn.classList.remove('disabled-btn');
            wBtn.innerHTML = `<i data-lucide="briefcase"></i> Jobs`;
            wBtn.onclick = () => PlayerActions.openJobSelector();
        } else if (Engine.state.player.lastWorkDay === Engine.state.day) {
            wBtn.classList.add('disabled-btn');
            wBtn.innerHTML = `<i data-lucide="check"></i> Shift Done`;
            wBtn.onclick = null;
        } else {
            wBtn.classList.remove('disabled-btn');
            wBtn.innerHTML = `<i data-lucide="coffee"></i> Work`;
            wBtn.onclick = () => PlayerActions.openLifeModal('work');
        }
        lucide.createIcons();
    },
    showFloatingMoney(amount) {
        const container = document.getElementById('money-container');
        if (!container) return;
        const floater = document.createElement('div');
        floater.className = `floating-money ${amount > 0 ? 'text-green' : 'text-red'}`;
        floater.innerText = amount > 0 ? `+$${amount.toFixed(2)}` : `-$${Math.abs(amount).toFixed(2)}`;
        container.style.position = 'relative';
        container.appendChild(floater);
        setTimeout(() => floater.remove(), 1500);
    },
    handleAvatarUpload(e) {
        const file = e.target.files[0]; 
        if(!file) return; 
        
        ImageCompressor.compress(file, 200, 0.8, (compressedData) => {
            Engine.state.player.avatar = compressedData; 
            UI.updateVitals(); 
        });
    },

    handleImageUpload(e) {
        const file = e.target.files[0]; 
        if(!file) return; 
        
        ImageCompressor.compress(file, 300, 0.8, (compressedData) => {
            Engine.artBuffer = compressedData; 
            document.getElementById('art-preview-box').innerHTML = `<input type="file" id="rel-art" accept="image/*" onchange="UI.handleImageUpload(event)"><img src="${Engine.artBuffer}">`; 
        });
    },
    updateLifeSlider(val) {
        document.getElementById('life-hours-display').innerText = val;
        let pct = ((val - 1) / 11) * 100;
        document.getElementById('life-hours-slider').style.background = `linear-gradient(to right, var(--accent-purple) ${pct}%, rgba(0, 0, 0, 0.4) ${pct}%)`;
        if (PlayerActions.currentAction === 'sleep') {
            let nrg = val * 8;
            if(Engine.state.player.perkId === 'sleeper') nrg *= 1.2;
            document.getElementById('life-impact-1').innerHTML = `<span class="text-green">+${nrg}% Energy</span>`;
            document.getElementById('life-impact-2').innerHTML = `<span class="text-green">-${val * 6}% Stress</span>`;
        }
        else if (PlayerActions.currentAction === 'pass') {
            document.getElementById('life-impact-2').innerHTML = `<span class="text-red">+${val * Game.config.settings.waitStressGainPerHour}% Stress</span>`;
        }
        else {
            let job = Game.config.jobs.find(j => j.id === Engine.state.player.jobId);
            document.getElementById('life-impact-1').innerHTML = `<span class="text-green">+$${val * job.wage} Cash</span>`;
            document.getElementById('life-impact-2').innerHTML = `<span class="text-orange">-${val * job.energyDrain}% Nrg</span> | <span class="text-red">+${val * job.stressGain}% Stress</span>`;
        }
    },
    switchMarketTab(tab) {
        document.getElementById('btn-market-gear').className = tab === 'gear' ? 'market-top-tab active' : 'market-top-tab';
        document.getElementById('btn-market-pros').className = tab === 'pros' ? 'market-top-tab active' : 'market-top-tab';
        document.getElementById('market-gear-container').classList.toggle('hidden', tab !== 'gear');
        document.getElementById('market-pros-container').classList.toggle('hidden', tab !== 'pros');
    },
    switchHQTab(tab) {
        // 1. Boutons Actifs
        document.getElementById('btn-hq-realestate').className = tab === 'realestate' ? 'market-top-tab active' : 'market-top-tab';
        document.getElementById('btn-hq-staff').className = tab === 'staff' ? 'market-top-tab active' : 'market-top-tab';
        
        // 2. Textes Explicatifs (Statiques)
        document.getElementById('hq-desc-realestate').classList.toggle('hidden', tab !== 'realestate');
        document.getElementById('hq-desc-staff').classList.toggle('hidden', tab !== 'staff');
        
        // 3. Grilles (Scrollables)
        document.getElementById('hq-realestate-container').classList.toggle('hidden', tab !== 'realestate');
        document.getElementById('hq-staff-container').classList.toggle('hidden', tab !== 'staff');
    },
    toggleMenu() {
        document.body.classList.toggle('menu-open');
    },
    filterMarket(filter) {
        document.querySelectorAll('.market-filter-btn').forEach(btn => btn.classList.remove('active'));
        document.querySelector(`.market-filter-btn[data-filter="${filter}"]`).classList.add('active');
        
        ['writing', 'recording', 'mixing'].forEach(cat => {
            let isMatch = (filter === 'all') || (cat === filter);
            document.getElementById(`gear-list-${cat}`).classList.toggle('hidden', !isMatch);
            document.getElementById(`pros-list-${cat}`).classList.toggle('hidden', !isMatch);
        });
    },
    filterMerch(filter) {
    // 1. Gestion de l'état actif uniquement
    document.querySelectorAll('.merch-filter-btn').forEach(btn => {
        // On retire simplement la classe active. 
        // On ne touche PAS à .style.opacity ni aux classes disabled.
        btn.classList.remove('active');
        
        if (btn.dataset.filter === filter) {
            btn.classList.add('active');
        }
    });

    // 2. Logique de filtrage des sections (Headers et Grilles)
    const catalog = document.getElementById('merch-catalog');
    const headers = catalog.querySelectorAll('.shop-category-header');
    
    headers.forEach(h => {
        const text = h.innerText.toUpperCase();
        const isPhysical = text.includes("PHYSICAL");
        const isApparel = text.includes("APPAREL") || text.includes("BRAND");
        const grid = h.nextElementSibling;

        let shouldShow = (filter === 'all') || 
                         (filter === 'physical' && isPhysical) || 
                         (filter === 'apparel' && isApparel);

        h.classList.toggle('hidden', !shouldShow);
        if (grid) grid.classList.toggle('hidden', !shouldShow);
    });
},
    switchMilestoneTab(tab) {
        document.getElementById('btn-milestones-active').className = tab === 'active' ? 'market-top-tab active' : 'market-top-tab';
        document.getElementById('btn-milestones-completed').className = tab === 'completed' ? 'market-top-tab active' : 'market-top-tab';
        document.getElementById('milestones-active-container').classList.toggle('hidden', tab !== 'active');
        document.getElementById('milestones-completed-container').classList.toggle('hidden', tab !== 'completed');
    },

    filterMilestones(filter) {
        // Gère l'effet "Allumé" sur le bouton cliqué
        document.querySelectorAll('.milestone-filter-btn').forEach(btn => btn.classList.remove('active'));
        document.querySelector(`.milestone-filter-btn[data-filter="${filter}"]`).classList.add('active');
        
        // Cache ou affiche les blocs correspondants
        const categories = ['Releases', 'Streaming', 'Collection', 'Fame', 'Challenges'];
        categories.forEach(cat => {
            let isMatch = (filter === 'all') || (cat === filter);
            let activeEl = document.getElementById(`milestones-active-${cat}`);
            let compEl = document.getElementById(`milestones-completed-${cat}`);
            if(activeEl) activeEl.classList.toggle('hidden', !isMatch);
            if(compEl) compEl.classList.toggle('hidden', !isMatch);
        });
    },
    renderStudio() {
        const list = document.getElementById('active-tracks'); 
    const staticTop = document.querySelector('#tab-studio .panel-static-top'); // Cible la zone fixe
    list.innerHTML = ''; 
    
    // Nettoyer les anciennes bannières avant d'en ajouter une
    const oldBanner = staticTop.querySelector('.staff-banner');
    if (oldBanner) oldBanner.remove();

    let active = Engine.state.tracks.filter(t => t.status === 'In Progress');
    
    if(active.length === 0) { 
        list.innerHTML = `<div class="empty-state"><i data-lucide="mic-off"></i><span>No active sessions.</span><span style="font-size: 0.8rem; opacity: 0.7;">Start a new session to create music.</span></div>`; 
        lucide.createIcons(); return; 
    }

    // Injecter la bannière dans la zone STATIQUE (fixe)
    if (Engine.state.staff.includes('staff_ghost') && active.length > 0) {
        const banner = document.createElement('div');
        banner.className = 'staff-banner banner-purple grid-span-full';
        banner.style.marginTop = "15px";
        banner.innerHTML = `
            <i data-lucide="headphones" style="width: 16px; height: 16px;"></i>
            <span><strong>Ghost Producer Active:</strong> He is passively improving track quality and progress in your active sessions.</span>`;
        staticTop.appendChild(banner);
    }
        active.forEach(t => {
            let pctLyr = Math.min(100, (t.lyrics / Engine.state.player.caps.writing) * 100);
            let pctRec = Math.min(100, (t.prod / Engine.state.player.caps.recording) * 100);
            let pctMix = Math.min(100, (t.mix / Engine.state.player.caps.mixing) * 100);
            let lyrColor = pctLyr >= 100 ? 'var(--accent-red)' : 'var(--accent-orange)';
            let recColor = pctRec >= 100 ? 'var(--accent-red)' : 'var(--accent-green)';
            let mixColor = pctMix >= 100 ? 'var(--accent-red)' : 'var(--accent-blue)';
            
            // NEW: Determine dynamic color based on the current stage
            let stageBadgeColor = t.currentStage === 'Writing' ? 'orange' : (t.currentStage === 'Recording' ? 'green' : 'blue');

            list.innerHTML += `
                <div class="data-node flex-col">
                    <div class="node-header">
                        <span>${t.title}</span>
                        <div class="flex-row gap-10">
                            <span class="badge badge-${stageBadgeColor}">${t.currentStage}</span>
                        </div>
                    </div>
                    <div class="flex-row gap-10 flex-start" style="margin-bottom: 15px;">
                         <span class="badge badge-purple">${t.genre} | ${t.vibe} | ${t.bpm} BPM</span>
                    </div>
                    <div class="text-muted" style="font-size: 0.70rem; margin-bottom: 8px; letter-spacing: 1px;">TRACK QUALITY & CAPS</div>
                    <div style="display: flex; gap: 8px; margin-bottom: 20px;">
                        <div class="stat-gauge">
                            <div class="stat-header"><i data-lucide="pen-tool" style="color: ${lyrColor}"></i><span class="stat-name">Lyr</span></div>
                            <div class="stat-values"><span class="current-val ${pctLyr >= 100 ? 'text-red' : ''}">${t.lyrics}</span><span class="max-val">/${Engine.state.player.caps.writing}</span></div>
                            <div class="stat-gauge-track"><div class="stat-gauge-fill" style="width: ${pctLyr}%; background: ${lyrColor};"></div></div>
                        </div>
                        <div class="stat-gauge">
                            <div class="stat-header"><i data-lucide="mic" style="color: ${recColor}"></i><span class="stat-name">Rec</span></div>
                            <div class="stat-values"><span class="current-val ${pctRec >= 100 ? 'text-red' : ''}">${t.prod}</span><span class="max-val">/${Engine.state.player.caps.recording}</span></div>
                            <div class="stat-gauge-track"><div class="stat-gauge-fill" style="width: ${pctRec}%; background: ${recColor};"></div></div>
                        </div>
                        <div class="stat-gauge">
                            <div class="stat-header"><i data-lucide="sliders" style="color: ${mixColor}"></i><span class="stat-name">Mix</span></div>
                            <div class="stat-values"><span class="current-val ${pctMix >= 100 ? 'text-red' : ''}">${t.mix}</span><span class="max-val">/${Engine.state.player.caps.mixing}</span></div>
                            <div class="stat-gauge-track"><div class="stat-gauge-fill" style="width: ${pctMix}%; background: ${mixColor};"></div></div>
                        </div>
                    </div>
                    <div class="progress-bar-bg" style="margin-bottom:15px;">
                        <div class="progress-bar-fill" style="width: ${t.progress}%; background: var(--accent-purple);"></div>
                    </div>
                    <div class="mt-auto" style="display:flex; gap:10px; align-items:center;">
                        <button class="btn-outline-purple" style="flex-grow: 1;" onclick="UI.openSessionModal('${t.id}')">Start Session</button>
                        <button class="btn-outline-red" style="padding: 0 10px;" onclick="MusicEngine.deleteTrack('${t.id}')"><i data-lucide="trash-2"></i> Scrap</button>
                    </div>
                </div>`;
        });
        lucide.createIcons();
    },
    updateSessionSlider(val) { 
        document.getElementById('session-hours-display').innerText = val; 
        document.getElementById('session-energy-cost').innerHTML = `<span class="text-orange">-${val * Game.config.settings.studioEnergyCostPerHour}% Energy</span>`; 
        document.getElementById('session-stress-cost').innerHTML = `<span class="text-red">+${val * Game.config.settings.studioStressGainPerHour}% Stress</span>`; 
        const pct = ((val - 1) / 4) * 100;
        document.getElementById('session-hours-slider').style.background = `linear-gradient(to right, var(--accent-purple) ${pct}%, rgba(0, 0, 0, 0.4) ${pct}%)`;
    },
    openSessionModal(id) { 
        const slider = document.getElementById('session-hours-slider'); 
        slider.value = 3; 
        this.updateSessionSlider(3); 
        document.getElementById('confirm-session-btn').onclick = () => { 
            this.closeModal('session-setup-modal'); 
            MusicEngine.workOnTrack(id, parseInt(slider.value)); 
        }; 
        this.openModal('session-setup-modal'); 
    },
    renderGear() {
        let currentProp = Game.config.properties.find(p => p.id === Engine.state.player.propertyId);
        let ownedCount = Game.config.gear.filter(x => x.owned).length;
        let capDisplay = document.getElementById('gear-capacity-display');
        
        if (capDisplay) {
            capDisplay.innerHTML = `<i data-lucide="box" class="${ownedCount >= currentProp.maxGear ? 'text-red' : 'text-purple'}"></i> Space: ${ownedCount} / ${currentProp.maxGear}`;
            if (ownedCount >= currentProp.maxGear) capDisplay.style.borderColor = 'rgba(255, 94, 87, 0.4)';
            else capDisplay.style.borderColor = '';
        }
        
        const categories = ['writing', 'recording', 'mixing'];
        const colorMap = { writing: 'orange', recording: 'green', mixing: 'blue' };
        const iconMap = { writing: 'pen-tool', recording: 'mic', mixing: 'sliders' };

        categories.forEach(cat => {
            let container = document.getElementById(`gear-list-${cat}`);
            if (!container) return;
            let badgeColor = colorMap[cat];
            let icon = iconMap[cat];

            // On réintègre le titre de la catégorie !
            container.innerHTML = `<div class="shop-category-header grid-span-full" style="--accent-color: var(--accent-${badgeColor});"><i data-lucide="${icon}" class="text-${badgeColor}"></i><span>${cat.toUpperCase()}</span></div>`;

            Game.config.gear.filter(g => g.capType === cat).forEach(g => {
                let gearFull = !g.owned && ownedCount >= currentProp.maxGear;
                let locked = Engine.state.player.followers < g.reqFans;
                let btnClass = (locked || gearFull) ? 'btn-outline disabled-btn' : `btn-outline-${badgeColor}`;
                let btn = '';
                if (g.owned) btn = `<button class="btn-outline w-100 mt-auto disabled-btn" disabled><i data-lucide="check-circle" class="text-green"></i> Installed</button>`;
                else if (gearFull) btn = `<button class="${btnClass} w-100 mt-auto" disabled><i data-lucide="lock"></i> HQ Full</button>`;
                else if (locked) btn = `<button class="${btnClass} w-100 mt-auto" disabled><i data-lucide="lock"></i>  ${g.reqFans.toLocaleString()} Fans</button>`;
                else btn = `<button class="${btnClass} w-100 mt-auto" onclick="MarketEngine.buyGear('${g.id}')">Buy $${g.cost.toLocaleString()}</button>`;
                
                container.innerHTML += `
                <div class="data-node flex-col" style="${g.owned ? 'border-color: rgba(11, 232, 129, 0.3);' : ''}">
                    <div style="margin-bottom: 15px;">
                        <strong style="font-size: 1.05rem;">${g.name}</strong><br>
                        <span class="badge badge-${badgeColor}" style="margin-top: 6px;"><i data-lucide="${icon}"></i> +${g.capIncrease} Cap</span>
                    </div>
                    ${btn}
                </div>`;
            });
        });
        if(window.lucide) lucide.createIcons();
    },
    renderHQ() {
    const container = document.getElementById('hq-list');
    const staffContainer = document.getElementById('staff-list');
    if (!container || !staffContainer) return;

    const currentId = Engine.state.player.propertyId;
    const currentProp = Game.config.properties.find(p => p.id === currentId);
    
    // --- SECTION 1 & 2 : PROPRIÉTÉS ---
    let html = `
    <div class="shop-category-header grid-span-full"><i data-lucide="home"></i> Current Headquarters</div>
    <div class="current-prop-card grid-span-full">
        <div class="prop-icon-large"><i data-lucide="building-2"></i></div>
        <div style="flex: 1;">
            <h2 style="margin: 0 0 5px 0;">${currentProp.title}</h2>
            <p class="text-muted" style="font-size: 0.9rem; margin-bottom: 12px;">Active Base • Rent: <span class="text-green">$${currentProp.rent}/mo</span></p>
            <div class="prop-stats-row" style="display: flex; gap: 10px; align-items: center;">
                <div class="badge badge-outline"><i data-lucide="layers" class="text-blue"></i> ${currentProp.maxGear} Slots</div>
                <div class="badge badge-outline"><i data-lucide="package" class="text-orange"></i> ${currentProp.maxBoxes.toLocaleString()} Units</div>
                <div class="badge badge-outline"><i data-lucide="zap" class="text-yellow"></i> x${currentProp.hypeBoost} Hype</div>
            </div>
        </div>
    </div>
    
    <div class="shop-category-header grid-span-full" style="margin-top:20px;"><i data-lucide="search"></i> Available Properties</div>`;

    Game.config.properties.forEach(p => {
        if(p.id === currentId) return;
        let locked = Engine.state.player.followers < p.reqFans;
        let btnClass = locked ? 'btn-outline disabled-btn' : 'btn-outline-purple';
        
        // ICI : On a ajouté le prix dans le bouton "Sign Lease ($X)"
        let btnText = locked ? `<i data-lucide="lock" style="width:14px;"></i> ${p.reqFans.toLocaleString()} Fans` : `Sign Lease ($${p.rent})`;
        
        html += `
        <div class="data-node flex-col">
            <div style="margin-bottom: 10px;">
                <strong style="display: flex; align-items: center; gap: 6px;"><i data-lucide="building" class="text-muted" style="width:16px;"></i> ${p.title}</strong>
            </div>
            <div style="font-family: var(--font-mono); font-size: 0.8rem; margin-bottom: 15px; background: rgba(0,0,0,0.2); padding: 10px; border-radius: 6px;">
                <div class="flex-row-between text-muted" style="margin-bottom:4px;">Gear: <span class="text-blue">${p.maxGear}</span></div>
                <div class="flex-row-between text-muted" style="margin-bottom:4px;">Stock: <span class="text-orange">${p.maxBoxes.toLocaleString()}</span></div>
                <div class="flex-row-between text-muted">Rent: <span class="text-green">$${p.rent}</span></div>
            </div>
            <button class="${btnClass} w-100 mt-auto" ${locked ? 'disabled' : `onclick="PlayerActions.leaseProperty('${p.id}')"`}>${btnText}</button>
        </div>`;
    });
    container.innerHTML = html;

    // --- SECTION 3 : ENTOURAGE ---
    let staffHtml = '';
    Game.config.staff.forEach(s => {
        let hired = Engine.state.staff.includes(s.id);
        let locked = Engine.state.player.followers < s.reqFans;
        let btnClass = hired || locked ? 'btn-outline disabled-btn' : 'btn-outline-green';
        let btnText = hired ? '<i data-lucide="check-circle" class="text-green" style="width:16px;"></i> On Payroll' : (locked ? `<i data-lucide="lock" style="width:16px;"></i> ${s.reqFans.toLocaleString()}` : `Hire ($${s.cost.toLocaleString()})`);
        
        staffHtml += `
        <div class="data-node flex-col" style="${hired ? 'border-color: var(--accent-purple); background: rgba(176, 91, 255, 0.05);' : ''}">
            <div class="flex-row gap-10" style="margin-bottom: 12px;">
                <i data-lucide="${s.icon}" class="text-purple"></i> <strong style="font-size: 1.05rem;">${s.title}</strong>
            </div>
            
            <span class="text-muted" style="font-size: 0.85rem; line-height: 1.4; margin-bottom: 15px; display: block; flex-grow: 1;">${s.desc}</span>
            
            <div style="font-family: var(--font-mono); font-size: 0.8rem; margin-bottom: 15px; background: rgba(0,0,0,0.2); padding: 8px; border-radius: 6px; text-align: center;">
                <span class="text-red">-$${s.wage}/day</span>
            </div>
            
            <button class="${btnClass} w-100 mt-auto" ${hired || locked ? 'disabled' : `onclick="EntourageEngine.hireStaff('${s.id}')"`}>${btnText}</button>
        </div>`;
    });
    staffContainer.innerHTML = staffHtml;

    if(window.lucide) lucide.createIcons();
},
    renderMerch() {
        const activeBtn = document.querySelector('.merch-filter-btn.active');
    if (!activeBtn) {
        const allBtn = document.querySelector('.merch-filter-btn[data-filter="all"]');
        if (allBtn) allBtn.classList.add('active');
    }
        const catalog = document.getElementById('merch-catalog');
        const invDisplay = document.getElementById('inventory-display');
        if (!catalog || !invDisplay) return;
        document.getElementById('stat-merch-revenue').innerText = (Engine.state.stats.merchRevenue || 0).toLocaleString(undefined, {minimumFractionDigits: 2});
        document.getElementById('stat-merch-items').innerText = (Engine.state.stats.merchItemsSold || 0).toLocaleString();
        let currentProp = Game.config.properties.find(p => p.id === Engine.state.player.propertyId);
        let totalStock = Object.values(Engine.state.inventory || {}).reduce((a, b) => a + b, 0);
        let capDisplay = document.getElementById('warehouse-capacity-display');
        if (capDisplay) {
            capDisplay.innerHTML = `<i data-lucide="box"></i> Space: ${totalStock.toLocaleString()} / ${currentProp.maxBoxes.toLocaleString()}`;
            capDisplay.className = totalStock >= currentProp.maxBoxes ? 'badge badge-outline text-red' : 'badge badge-outline';
        }
        let invHtml = '';
        if (Engine.state.inventory) {
            Object.keys(Engine.state.inventory).forEach(invKey => {
                let qty = Engine.state.inventory[invKey];
                if (qty > 0) {
                    let [itemId, releaseId] = invKey.split('|');
                    let itemDef = Game.config.merch.find(m => m.id === itemId);
                    let relName = "";
                    if(releaseId) {
                        let rel = Engine.state.releases.find(r => r.id === releaseId);
                        relName = rel ? ` <span class="text-muted" style="font-size:0.7rem;">[${rel.title}]</span>` : "";
                    }
                    let vel = Engine.state.inventoryVelocity ? (Engine.state.inventoryVelocity[invKey] || 0) : 0;
                    let velText = vel > 0 ? `<span class="text-green" style="font-size:0.75rem; font-family: var(--font-mono); margin-left: 10px;">↓ ${vel}/day</span>` : '';
                    if(itemDef) {
                        invHtml += `<div class="data-node flex-row-between" style="padding: 10px 15px;"><div class="flex-row gap-10"><i data-lucide="${itemDef.icon}" class="text-purple"></i> <strong>${itemDef.title}</strong> ${relName} ${velText}</div><span class="badge badge-outline">${qty.toLocaleString()} in stock</span></div>`;
                    }
                }
            });
        }
       let staffBanner = '';
       
        // Dans UI.renderMerch
const inventoryPanel = document.getElementById('tab-merch').querySelector('.panel:last-child');
const inventoryHeader = inventoryPanel.querySelector('.panel-header');

// Supprimer l'ancienne bannière si elle existe pour éviter les doublons
const oldBanner = inventoryPanel.querySelector('.staff-banner');
if (oldBanner) oldBanner.remove();

if (Engine.state.staff.includes('staff_merch')) {
    const banner = document.createElement('div');
    banner.className = 'staff-banner banner-green';
    banner.style.margin = "15px 20px 0 20px"; // Ajuster pour l'alignement
    banner.innerHTML = `
        <i data-lucide="package" style="width: 16px; height: 16px;"></i>
        <span><strong>Fulfillment Manager Active:</strong> Orders are auto-packed. Zero energy drain.</span>`;
    
    // Insérer la bannière entre le header et le contenu scrollable
    inventoryHeader.after(banner);
}

// Ensuite, remplissez invDisplay normalement sans la bannière
invDisplay.innerHTML = invHtml || `<div class="empty-state"><i data-lucide="box"></i><span>Warehouse empty.</span></div>`;
        let eligibleReleases = Engine.state.releases.filter(r => r.status === 'Live' && r.format !== 'Single');
        let relOptions = eligibleReleases.map(r => `<option value="${r.id}">${r.title} (${r.format})</option>`).join('');
        catalog.className = 'grid-4-col gap-15'; 
        let catHtml = '';
let categories = ['physical', 'apparel']; 
categories.forEach(cat => {
    let items = Game.config.merch.filter(m => m.category === cat);
    if(items.length === 0) return;
    
    let catTitle = cat === 'physical' ? 'Physical Music Releases' : 'Apparel & Brand Logo';
    let catIcon = cat === 'physical' ? 'disc' : 'shirt';
    let catColor = cat === 'physical' ? 'blue' : 'orange';

    // 1. On ajoute le header qui prend toute la largeur
    catHtml += `<div class="shop-category-header grid-span-full" style="--accent-color: var(--accent-${catColor})"><i data-lucide="${catIcon}" class="text-${catColor}"></i><span>${catTitle}</span></div>`;
    
    // 2. CRUCIAL : On ouvre une div avec la classe 'grid-4-col' pour que les cartes soient côte à côte
    catHtml += `<div class="grid-4-col gap-15 grid-span-full">`; 

    items.forEach(m => {
        let overCapacity = (totalStock + m.batchSize) > currentProp.maxBoxes;
        let locked = Engine.state.player.followers < m.reqFans;
        let btnClass = locked || overCapacity ? 'btn-outline disabled-btn' : 'btn-outline-green';
        let btnText = locked ? `<i data-lucide="lock"></i> ${m.reqFans.toLocaleString()} Fans` : (overCapacity ? `<i data-lucide="alert-circle"></i> HQ Full` : `Buy Batch ($${m.costPerBatch.toLocaleString()})`);
        let unitProfit = (m.retailPrice - (m.costPerBatch / m.batchSize)).toFixed(2);
        
        let dropdownHtml = '';
        if (m.category === 'physical' && !locked) {
            if (eligibleReleases.length === 0) {
                btnClass = 'btn-outline disabled-btn';
                btnText = "No Albums Live";
            } else {
                dropdownHtml = `<select id="select-rel-${m.id}" style="margin-bottom: 10px; width: 100%; font-size: 0.8rem; padding: 5px;">${relOptions}</select>`;
            }
        }

        catHtml += `
        <div class="data-node flex-col">
            <div style="margin-bottom: 10px;">
                <strong style="display: flex; align-items: center; gap: 6px;"><i data-lucide="${m.icon}" class="text-muted"></i> ${m.title}</strong>
            </div>
            <div style="font-family: var(--font-mono); font-size: 0.8rem; margin-bottom: 15px; background: rgba(0,0,0,0.2); padding: 10px; border-radius: 6px;">
                <div class="flex-row-between text-muted" style="margin-bottom:4px;">Size: <span class="text-main">${m.batchSize}</span></div>
                <div class="flex-row-between text-muted" style="margin-bottom:4px;">Price: <span class="text-green">$${m.retailPrice}</span></div>
                <div class="flex-row-between text-muted">Profit: <span class="text-yellow">+$${unitProfit}/ea</span></div>
            </div>
            <div class="mt-auto">
                ${dropdownHtml}
                <button class="${btnClass} w-100" ${locked || overCapacity || (m.category === 'physical' && eligibleReleases.length === 0) ? 'disabled' : `onclick="MerchEngine.buyBatch('${m.id}')"`}>${btnText}</button>
            </div>
        </div>`;
    });
    
    catHtml += `</div>`; // On ferme la div grid-4-col
});
catalog.innerHTML = catHtml;
        this.initCustomSelects(); 
        if (!UI.merchChart && document.getElementById('merchChart')) {
            UI.merchChart = new Chart(document.getElementById('merchChart').getContext('2d'), { type: 'bar', data: { labels: ['-6d', '-5d', '-4d', '-3d', '-2d', 'Yday', 'Today'], datasets: [{ label: 'Merch Revenue', data: Engine.state.stats.merchHistory, backgroundColor: '#0be881', borderRadius: 4 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, grid: {color: 'rgba(255,255,255,0.05)'} }, x: { grid: {display: false} } } } });
        }
        if(window.lucide) lucide.createIcons();
    },
    renderVault() {
        const list = document.getElementById('vault-list'); 
        if (!list) return;
        list.innerHTML = '';
        let vault = Engine.state.tracks.filter(t => t.status === 'Ready');
        if(vault.length===0) { 
            list.innerHTML = `<div class="empty-state"><i data-lucide="folder-open"></i><span>Vault is empty.</span><span style="font-size: 0.8rem; opacity: 0.7;">Finish studio sessions to master tracks.</span></div>`; 
            if(window.lucide) lucide.createIcons(); 
            return; 
        }
        vault.forEach(t => {
            list.innerHTML += `
            <div class="data-node flex-col">
                <div class="node-header flex-row-between" style="margin-bottom: 8px;">
                    <span>${t.title}</span>
                    <button class="btn-icon" onclick="UI.renameTrack('${t.id}')"><i data-lucide="edit-3"></i></button>
                </div>
                <div class="flex-row gap-10 flex-start" style="margin-bottom: 12px; flex-wrap: wrap;">
                    <span class="badge badge-purple">${t.genre} | ${t.bpm} BPM</span>
                </div>
                <div class="flex-row gap-10 flex-start" style="flex-wrap: wrap;">
                    <span class="badge badge-outline" style="border-color: rgba(11, 232, 129, 0.4);"><i data-lucide="star" class="text-green"></i> Qual: ${t.quality}</span>
                    <span class="badge badge-outline"><i data-lucide="pen-tool" class="text-orange"></i> Lyr: ${t.lyrics}</span>
                    <span class="badge badge-outline"><i data-lucide="mic" class="text-green"></i> Rec: ${t.prod}</span>
                    <span class="badge badge-outline"><i data-lucide="sliders" class="text-blue"></i> Mix: ${t.mix}</span>
                </div>
            </div>`;
        });
        if(window.lucide) lucide.createIcons();
    },
    renderMilestones() {
        const activeContainer = document.getElementById('milestones-active-container');
        const compContainer = document.getElementById('milestones-completed-container');
        if(!activeContainer || !compContainer) return;
        
        activeContainer.innerHTML = '';
        compContainer.innerHTML = '';
        
        const categories = [...new Set(Game.config.achievements.map(a => a.category))];
        const catIcons = { 
            'Streaming': { icon: 'trending-up', color: 'purple' },
            'Fame': { icon: 'users', color: 'blue' },
            'Collection': { icon: 'package', color: 'yellow' },
            'Releases': { icon: 'disc', color: 'green' },
            'Challenges': { icon: 'target', color: 'orange' }
        };

        // Mise à jour du badge global de complétion
        let completedCount = Game.config.achievements.filter(a => a.unlocked).length;
        let totalCount = Game.config.achievements.length;
        let completionBadge = document.getElementById('milestones-completion-display');
        if(completionBadge) {
            completionBadge.innerHTML = `<i data-lucide="check-circle" class="${completedCount === totalCount ? 'text-green' : 'text-purple'}"></i> ${completedCount} / ${totalCount}`;
        }

        // Variables pour tracker si les listes sont vides
        let hasActive = false;
        let hasCompleted = false;

        categories.forEach(cat => {
            const info = catIcons[cat] || { icon: 'award', color: 'muted' };
            
            let activeItems = Game.config.achievements.filter(a => a.category === cat && !a.unlocked);
            let compItems = Game.config.achievements.filter(a => a.category === cat && a.unlocked);

            // Construction du bloc des succès EN COURS
            if(activeItems.length > 0) {
                hasActive = true;
                let html = `<div id="milestones-active-${cat}" class="flex-col gap-15 w-100">`;
                html += `<div class="shop-category-header grid-span-full" style="--accent-color: var(--accent-${info.color});"><i data-lucide="${info.icon}" class="text-${info.color}"></i><span>${cat.toUpperCase()}</span></div>`;
                html += `<div class="grid-span-full grid-3-col gap-15">`;
                activeItems.forEach(a => {
                    html += `
                    <div class="data-node flex-col">
                        <div>
                            <strong style="font-size: 1.05rem;">${a.title}</strong><br>
                            <span class="text-muted" style="font-size: 0.8rem; display: block; margin-top: 4px;">${a.desc}</span>
                        </div>
                        <div class="text-yellow" style="font-size: 0.8rem; margin-top: 10px; font-weight: bold;">Reward: $${a.reward.toLocaleString()}</div>
                        <div class="text-muted mt-10"><i data-lucide="lock" style="width:14px;"></i> In Progress</div>
                    </div>`;
                });
                html += `</div></div>`;
                activeContainer.innerHTML += html;
            }

            // Construction du bloc des succès COMPLÉTÉS
            if(compItems.length > 0) {
                hasCompleted = true;
                let html = `<div id="milestones-completed-${cat}" class="flex-col gap-15 w-100">`;
                html += `<div class="shop-category-header grid-span-full" style="--accent-color: var(--accent-${info.color});"><i data-lucide="${info.icon}" class="text-${info.color}"></i><span>${cat.toUpperCase()}</span></div>`;
                html += `<div class="grid-span-full grid-3-col gap-15">`;
                compItems.forEach(a => {
                    html += `
                    <div class="data-node flex-col" style="border-color: rgba(11, 232, 129, 0.4); background: rgba(11, 232, 129, 0.05);">
                        <div>
                            <strong style="font-size: 1.05rem;">${a.title}</strong><br>
                            <span class="text-muted" style="font-size: 0.8rem; display: block; margin-top: 4px;">${a.desc}</span>
                        </div>
                        <div class="text-yellow" style="font-size: 0.8rem; margin-top: 10px; font-weight: bold;">Reward: $${a.reward.toLocaleString()}</div>
                        <div class="text-green mt-10"><i data-lucide="check-circle" style="width:14px;"></i> Unlocked</div>
                    </div>`;
                });
                html += `</div></div>`;
                compContainer.innerHTML += html;
            }
        });

        // -----------------------------------------------------
        // GESTION DES EMPTY STATES SI AUCUN ITEM TROUVÉ
        // -----------------------------------------------------
        if (!hasActive) {
            activeContainer.innerHTML = `<div class="empty-state"><i data-lucide="award"></i><span>No active milestones.</span><span style="font-size: 0.8rem; opacity: 0.7;">You have completed every challenge available!</span></div>`;
        }
        
        if (!hasCompleted) {
            compContainer.innerHTML = `<div class="empty-state"><i data-lucide="target"></i><span>No completed milestones yet.</span><span style="font-size: 0.8rem; opacity: 0.7;">Keep hustling to unlock achievements and cash rewards.</span></div>`;
        }

        lucide.createIcons();
        
        // S'assure que si on re-render (gain d'un milestone), le filtre actuel reste appliqué
        let currentFilter = document.querySelector('.milestone-filter-btn.active')?.dataset.filter || 'all';
        this.filterMilestones(currentFilter);
    },
          
    openReleaseModal() {
        Engine.artBuffer = null; Engine.pendingTracklist = [];
        DistroEngine.currentDistro = 'sc'; 
        document.getElementById('art-preview-box').innerHTML = `<input type=\"file\" id=\"rel-art\" accept=\"image/*\" onchange=\"UI.handleImageUpload(event)\"><span id=\"art-placeholder\" style=\"flex-direction: column;\"><i data-lucide=\"image\"></i> Art</span>`;
        let vault = Engine.state.tracks.filter(t => t.status === 'Ready');
        document.getElementById('vault-selector').innerHTML = `<option value=\"\">-- Select Track --</option>` + vault.map(t => `<option value=\"${t.id}\">${t.title} (Q:${t.quality})</option>`).join('');
        const fmtSel = document.getElementById('rel-format'); fmtSel.innerHTML = '';
        Game.config.releaseFormats.forEach(f => {
            let locked = (Engine.state.stats.singles < f.reqSingles) || (Engine.state.stats.eps < f.reqEps) || (Engine.state.player.followers < f.reqFans);
            let lockText = locked ? `${f.title} (Req: ${f.reqSingles?f.reqSingles+' Singles ':''}${f.reqEps?f.reqEps+' EPs ':''}${f.reqFans?f.reqFans.toLocaleString()+' Fans':''})` : f.title;
            fmtSel.innerHTML += `<option value="${f.id}" ${locked?'disabled':''}>${lockText}</option>`;
        });
        const visSel = document.getElementById('rel-visuals'); visSel.innerHTML = '';
        Game.config.visualOptions.forEach(v => {
            let locked = Engine.state.player.followers < v.reqFans;
            let lockText = locked ? `${v.title} (Req: ${v.reqFans.toLocaleString()} Fans)` : `${v.title} (${v.cost === 0 ? 'FREE' : '+$' + v.cost})`;
            visSel.innerHTML += `<option value="${v.id}" ${locked?'disabled':''}>${lockText}</option>`;
        });
        this.renderDistroOptions();
        this.updateReleaseFormatUI(); 
        DistroEngine.renderPendingTracklist();
        this.openModal('release-modal');
    },
    updateReleaseFormatUI() { 
        let formatStr = document.getElementById('rel-format').value;
        let formatObj = Game.config.releaseFormats.find(f => f.id === formatStr);
        if(formatObj) {
            document.getElementById('tracklist-req').innerText = `(${formatObj.min}${formatObj.max > formatObj.min ? '-' + formatObj.max : ''})`;
        }
    },
    
    renderReleases() {
        const pipeList = document.getElementById('pipeline-list'); 
        const liveList = document.getElementById('live-discography-list');
        if (!pipeList || !liveList) return;
        let upcoming = Engine.state.releases.filter(r => r.status === 'Scheduled');
        let live = Engine.state.releases.filter(r => r.status === 'Live');
        if (upcoming.length === 0) {
            pipeList.innerHTML = `<div class="empty-state" style="min-height: 80px;"><i data-lucide="clock"></i><span>No upcoming releases scheduled.</span></div>`;
        } else {
           pipeList.innerHTML = [...upcoming].reverse().map(rel => {
                let artSrc = rel.artData || "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100'><rect width='100' height='100' fill='%23121218'/><circle cx='50' cy='50' r='20' fill='%231a1a24' stroke='%23b05bff' stroke-width='2'/></svg>";
                let daysLeft = rel.dropDay - Engine.state.day;
                return `
                <div class="data-node flex-row-between" style="padding: 10px 15px; align-items: center; border-left: 3px solid var(--accent-yellow);">
                    <div class="flex-row gap-15">
                        <img src="${artSrc}" style="width: 40px; height: 40px; border-radius: 4px; object-fit: cover;">
                        <div>
                            <strong style="font-size: 1.05rem;">${rel.title}</strong>
                            <div class="text-muted" style="font-size: 0.8rem; margin-top: 4px;">${rel.format} | ${rel.visualName}</div>
                        </div>
                    </div>
                    <div class="badge badge-yellow"><i data-lucide="clock"></i> DROPS IN ${daysLeft} DAYS</div>
                </div>`;
            }).join('');
        }
        if (live.length === 0) {
            liveList.innerHTML = `<div class="empty-state"><i data-lucide="disc"></i><span>Your discography is empty. Package a release to begin.</span></div>`;
        } else {
            liveList.innerHTML = [...live].reverse().map(rel => {
                let artSrc = rel.artData || "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100'><rect width='100' height='100' fill='%23121218'/><circle cx='50' cy='50' r='20' fill='%231a1a24' stroke='%23b05bff' stroke-width='2'/></svg>";
                let dspStat = rel.platforms.includes('dsp') ? `<div class="text-main" style="font-family: var(--font-mono); font-size: 1.1rem; font-weight: 800;">${rel.streams.toLocaleString()}</div>` : '';
                let revStat = rel.platforms.includes('dsp') ? `<div class="text-green" style="font-family: var(--font-mono); font-size: 0.85rem; font-weight: bold;">$${(rel.revenue || 0).toFixed(2)}</div>` : '';
                let momentumText = rel.activeMultiplier > 0.5 ? '<span class="text-green">Trending</span>' : '<span class="text-muted">Legacy</span>';
                let tracklistHtml = '';
                if (rel.tracks && rel.tracks.length > 0) {
                    tracklistHtml = `<div class="release-tracklist">` + 
                        rel.tracks.map((t, idx) => `<div>${idx + 1}. ${t.title}</div>`).join('') + 
                    `</div>`;
                }
                let currentVisIndex = Math.max(0, Game.config.visualOptions.findIndex(v => v.title === rel.visualName));
                let isMaxVisual = currentVisIndex >= Game.config.visualOptions.length - 1;
                let visBtnClass = isMaxVisual ? 'btn-outline disabled-btn' : 'btn-outline-purple';
                let visBtnText = isMaxVisual ? 'Max Visuals' : 'Upgrade Visuals';
                let visBtnAction = isMaxVisual ? 'disabled' : `onclick="PlayerActions.openVisualsModal('${rel.id}')"`;
                return `
                <div class="release-manage-card">
                    <img src="${artSrc}" class="release-cover-art">
                    <div class="flex-col" style="min-width: 0;">
                        <div style="font-weight: 800; font-size: 1.15rem; margin-bottom: 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${rel.title}</div>
                        <div class="flex-row gap-10" style="margin-bottom: 8px;">
                            <span class="badge badge-purple" style="margin-top:0 !important;">${rel.format}</span>
                            <span class="text-muted" style="font-size: 0.8rem;"><i data-lucide="music" style="width:12px;"></i> ${rel.tracks.length} Tracks</span>
                        </div>
                        <div class="text-muted" style="font-size: 0.75rem;"><i data-lucide="video" style="width:12px;"></i> ${rel.visualName}</div>
                        ${tracklistHtml}
                    </div>
                    <div class="release-stats-group">
                        <div class="text-muted" style="font-size: 0.7rem; text-transform: uppercase; margin-bottom: 4px;">DSP Streams</div>
                        ${dspStat}
                        ${revStat}
                        <div style="margin-top: 6px; font-size: 0.75rem; font-family: var(--font-mono);">${momentumText}</div>
                    </div>
                    <div class="flex-col gap-10">
                        <button class="btn-outline-blue btn-small" style="justify-content: flex-start;" onclick="PlayerActions.marketingPush('${rel.id}')">
                            <i data-lucide="trending-up"></i> Algorithmic Push ($500)
                        </button>
                        <button class="${visBtnClass} btn-small" style="justify-content: flex-start;" ${visBtnAction}>
                            <i data-lucide="video"></i> ${visBtnText}
                        </button>
                    </div>
                </div>`;
            }).join('');
        }
        if(window.lucide) lucide.createIcons();
    },
    renderLeaderboard() {
        let allData = [...Engine.state.bots];
        allData.push({ name: Engine.state.player.name, dailyStreams: Engine.state.chartHistory[Engine.state.chartHistory.length-1] || 0, isPlayer: true });
        allData.sort((a,b) => b.dailyStreams - a.dailyStreams);
        let html = '';
        allData.slice(0, 20).forEach((entry, i) => {
            html += `
                <tr class="${entry.isPlayer ? 'player-row' : ''}">
                    <td>#${i+1}</td>
                    <td>${entry.name}</td>
                    <td>${entry.dailyStreams.toLocaleString()}</td> </tr>`;
        });
        document.getElementById('leaderboard-body').innerHTML = html;
    },
    initChart() {
        if (Engine.chart) Engine.chart.destroy();
        Engine.chart = new Chart(document.getElementById('streamsChart').getContext('2d'), { type: 'line', data: { labels: ['-6d', '-5d', '-4d', '-3d', '-2d', 'Yday', 'Today'], datasets: [{ label: 'DSP Streams', data: Engine.state.chartHistory, borderColor: '#b05bff', backgroundColor: 'rgba(176, 91, 255, 0.15)', fill: true, tension: 0.4, borderWidth: 2, pointBackgroundColor: '#b05bff' }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, grid: {color: 'rgba(255,255,255,0.05)'} }, x: { grid: {display: false} } } } });
    },
    showAlert(title, message) { 
        document.getElementById('alert-title').innerText = title.toUpperCase(); 
        document.getElementById('alert-message').innerHTML = message; 
        this.openModal('system-alert-modal'); 
        lucide.createIcons(); 
    },
    showConfirm(title, message, onConfirmCallback) {
        document.getElementById('confirm-title').innerText = title.toUpperCase(); 
        document.getElementById('confirm-message').innerHTML = message; 
        const btn = document.getElementById('confirm-yes-btn'); const newBtn = btn.cloneNode(true); btn.parentNode.replaceChild(newBtn, btn);
        newBtn.onclick = () => { this.closeModal('system-confirm-modal'); onConfirmCallback(); }; 
        this.openModal('system-confirm-modal'); 
        lucide.createIcons();
    },
    updateChart(newStreams) {
        Engine.state.chartHistory.push(newStreams); 
        Engine.state.chartHistory.shift(); 
        Engine.chart.data.datasets[0].data = Engine.state.chartHistory; 
        Engine.chart.update();
        let streamingRev = Engine.state.stats.totalRevenue || 0;
        let merchRev = Engine.state.stats.merchRevenue || 0;
        document.getElementById('stat-total-revenue').innerText = (streamingRev + merchRev).toFixed(2);
        document.getElementById('stat-total-streams').innerText = Engine.state.stats.totalStreams.toLocaleString();
    },
    renameTrack(id) {
        let track = Engine.state.tracks.find(t => t.id === id);
        if (!track) return;
        document.getElementById('rename-track-id').value = track.id;
        document.getElementById('rename-track-input').value = track.title;
        this.openModal('rename-modal');
        if(window.lucide) lucide.createIcons();
    },
    confirmRename() {
        let id = document.getElementById('rename-track-id').value;
        let newTitle = document.getElementById('rename-track-input').value.trim();
        let track = Engine.state.tracks.find(t => t.id === id);
        if (track && newTitle !== "") {
            track.title = newTitle;
            this.closeModal('rename-modal');
            this.renderVault();
            Engine.log(`Renamed track to "${track.title}".`);
            if (Engine.state.preferences && Engine.state.preferences.autosave) {
                Engine.saveGame(true);
            }
        } else {
            this.showAlert("Invalid Title", "Track title cannot be empty.");
        }
    },
};

document.addEventListener('DOMContentLoaded', async () => {
    await Game.loadConfig();
    UI.populateDropdowns();
    UI.renderServices();
    UI.initCustomSelects();
    
    document.addEventListener('focusout', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
            setTimeout(() => {
                window.scrollTo(0, 0);
            }, 100);
        }
    });
});