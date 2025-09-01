# Railway Deployment Instructions

## Step 1: Create Railway Account
1. Go to https://railway.app
2. Sign up with GitHub account
3. Create new project

## Step 2: Deploy from GitHub
1. Click "Deploy from GitHub repo"
2. Select your repository
3. Set root directory to: `railway-expert-search`
4. Railway will auto-detect Node.js

## Step 3: Configure Environment Variables
In Railway dashboard, go to Variables tab and add:

```
CLADO_API_KEY=your_clado_api_key
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url  
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_key
PORT=3001
```

## Step 4: Deploy
1. Railway will automatically build and deploy
2. You'll get a URL like: `https://your-app-name.railway.app`
3. Copy this URL

## Step 5: Update Main App
Add to your main app's `.env.local` and Vercel environment:

```
RAILWAY_EXPERT_SEARCH_URL=https://your-app-name.railway.app
```

## Step 6: Test
1. Check health: `https://your-app-name.railway.app/health`
2. Should return: `{"status":"healthy","timestamp":"...","activePolling":0}`

## Important Notes:
- Railway provides persistent servers (perfect for polling)
- This service runs 24/7 independently of your main app
- Each expert search gets tracked with unique call IDs
- Polling continues even if main app goes down