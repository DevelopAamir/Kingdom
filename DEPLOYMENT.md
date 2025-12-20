# Battle Royale Game - Deployment Guide

## Deploy to Render

### Prerequisites
- GitHub account
- Render account (free tier works)

### Steps to Deploy

1. **Push your code to GitHub** (if not already done):
   ```bash
   git add .
   git commit -m "Ready for deployment"
   git push origin main
   ```

2. **Go to Render Dashboard**:
   - Visit https://render.com
   - Sign in with your GitHub account

3. **Create New Web Service**:
   - Click "New +" → "Web Service"
   - Connect your GitHub repository: `DevelopAamir/Kingdom`
   - Click "Connect"

4. **Configure the Service**:
   - **Name**: `battle-royale-game` (or your preferred name)
   - **Region**: Choose closest to your users
   - **Branch**: `main`
   - **Root Directory**: Leave empty
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: `Free`

5. **Environment Variables** (if needed):
   - Click "Advanced"
   - Add any environment variables (none required for basic setup)

6. **Deploy**:
   - Click "Create Web Service"
   - Wait 2-5 minutes for deployment
   - Your game will be live at: `https://your-service-name.onrender.com`

### Important Notes

- **Free Tier Limitations**:
  - Service spins down after 15 minutes of inactivity
  - First request after inactivity takes ~30 seconds to wake up
  - 750 hours/month free (enough for testing)

- **WebSocket Support**: 
  - Render fully supports WebSockets/Socket.IO ✅
  - No additional configuration needed

- **Database**:
  - SQLite database will persist on the server
  - For production, consider upgrading to PostgreSQL

### Testing Your Deployment

1. Visit your Render URL
2. Create an account and log in
3. Test on mobile by visiting the URL on your phone
4. Share the URL with friends to test multiplayer!

### Troubleshooting

- **Build fails**: Check the build logs in Render dashboard
- **App doesn't start**: Verify `package.json` has correct start script
- **Can't connect**: Check if WebSocket connections are allowed (they are by default on Render)
