# Railway Expert Search Service

This is a **completely independent Node.js server** designed to run on Railway.app.

## Purpose
- Handles persistent expert search polling that requires long-running processes
- Runs separately from the main Next.js application on Vercel
- Provides reliable background processing for Clado expert searches

## Why Separate Service?
- Vercel serverless functions can't maintain persistent timers/polling
- Railway provides always-on servers perfect for background tasks
- Isolates complex polling logic from main application

## Deployment
This folder should be deployed as a standalone Node.js application to Railway.app