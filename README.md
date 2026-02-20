# Seagull Assets Starter Project

This is a **starter project** for the Seagull Assets synthetic pool system — a multi-pool synthetic asset engine with swap functionality, fee retention, and AI integration hooks.

It includes:

- **Frontend**: Static GitHub Pages site (`frontend/`)  
- **Backend**: Node.js + Express API (`backend/`)  
- **Database**: SQLite starter database (`database/seagull.db`)  
- **AI**: OpenAI API hook for dynamic fee calculation (`backend/ai/dynamicFee.js`)

---

## Features

1. **Synthetic Pools**: XRP, FLR, and XDC pools  
2. **Swap Engine**: Users can swap between pools; 2.5% fee retained in origin pool  
3. **Treasury Tracking**: Accumulated fees stored in treasury  
4. **AI Hooks**: Ready for dynamic fee adjustment using OpenAI API  
5. **Frontend**: Simple swap interface hosted on GitHub Pages  
