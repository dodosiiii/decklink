# DeckLink

Contrôle à distance de votre PC Windows depuis n'importe quel navigateur.

## Fonctionnalités

- **Grille d'applications** : lancez vos apps depuis le téléphone/tablette
- **Now Playing** : détection automatique de la musique en cours (titre, artiste, album, durée, cover)
- **Mini-player** : barre persistante qui suit la lecture même en changeant de page
- **Deezer** : top tracks, recherche, lecture
- **Monitoring** : CPU, RAM, disque, GPU, température, processus
- **Contrôle média** : play/pause, suivant, précédent, volume
- **Souris distante** : touchpad, clics, défilement
- **Clavier distant** : texte + raccourcis (Ctrl+C, etc.)
- **Explorateur de fichiers** : navigation + téléchargement
- **Presse-papier** : lire/envoyer depuis le presse-papier du PC
- **Capture d'écran** : screenshot + mode Live
- **Wake-on-LAN** : réveil à distance
- **Services Windows** : démarrer/arrêter
- **Fond d'écran** : changer le wallpaper
- **Contrôle système** : verrouiller, veille, éteindre, redémarrer
- **Thème personnalisable** : couleurs, logo, nom
- **Assistant de configuration** : détection automatique des apps au premier lancement

## Prérequis

- Windows 10/11
- Python 3.9+

## Installation

```powershell
# Cloner / extraire le projet
cd decklink

# Lancer l'installation
start_host.bat
```

Ou manuellement :

```powershell
pip install flask flask-socketio eventlet psutil nvidia-ml-py wmi pywin32 pycaw comtypes Pillow pyautogui mss
python host\server.py
```

## Utilisation

1. Lancez `start_host.ps1` (ou `start_host.bat`)
2. Ouvrez l'URL affichée dans la console (ex: `http://192.168.1.42:5000`)
3. L'assistant de configuration vous guide au premier lancement

## Structure

```
decklink/
├── host/
│   ├── server.py        # Serveur Flask + Socket.IO
│   └── config.json      # Configuration utilisateur
├── client/
│   ├── index.html       # Interface web
│   ├── style.css        # Styles (thème sombre)
│   └── app.js           # Logique client Socket.IO
├── start_host.ps1       # Lanceur avec élévation admin
├── start_host.bat       # Lanceur simple
└── README.md
```

## Détection des apps

Le serveur scanne le Menu Démarrer et le PATH pour détecter automatiquement les applications installées. Icônes réelles extraites des fichiers `.exe`. 50+ apps connues avec icônes et couleurs prédéfinies.
