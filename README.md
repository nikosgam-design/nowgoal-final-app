
# Nowgoal Ultimate Final

Deploy to Vercel:
1. Upload this zip/project to Vercel
2. Build command: npm run build
3. Output directory: dist

After deploy:
- Open the app
- Paste Nowgoal match text in Analyzer mode
- Add your Telegram placeholder values
- Add your Firebase placeholder values
- Save, sync, and send alerts

Notes:
- Telegram sending from browser exposes the bot token to the client. For production security, move Telegram sending to a backend function.
- Live Auto mode is demo-fed until you connect a real live API.
