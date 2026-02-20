# Seagull Assets Bridge and Swap

This is the Seagull Asset Pool Bridge System — a multi-pool Layer 2 asset engine with swap functionality, fee retention, and AI integration hooks.

It includes:

- **Frontend**: Static GitHub Pages site (`frontend/`)  
- **Backend**: Node.js + Express API (`backend/`)  
- **Database**: SQLite starter database (`database/seagull.db`)  
- **AI**: OpenAI API hook for dynamic fee calculation (`backend/ai/dynamicFee.js`)

---

## Features

1. **Layer 2 Pools**: XRP <-> FLR <-> XDC pools as well as XLM <-> XRP <-> HBAR
3. **Swap Engine**: Users can swap between pools; 2.5% fee retained in origin pool  
4. **Treasury Tracking**: Accumulated fees stored in treasury  
5. **AI Hooks**: Ready for dynamic fee adjustment using OpenAI API  
6. **Frontend**: Simple swap interface hosted on GitHub Pages  
