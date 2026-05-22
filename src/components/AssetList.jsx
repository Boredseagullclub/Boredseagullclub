import React from 'react';
import { Coins, ArrowUpRight, ShieldCheck } from 'lucide-react';

const AssetList = ({ user }) => {
  // Mocking the chain icons/colors for the Diamond feel
    const chainStyles = {
    XLM: { color: 'text-blue-400', bg: 'bg-blue-400/10', name: 'Stellar' },
    HBAR: { color: 'text-purple-400', bg: 'bg-purple-400/10', name: 'Hedera' },
    XDC: { color: 'text-emerald-400', bg: 'bg-emerald-400/10', name: 'XDC' },
    FLR: { color: 'text-red-400', bg: 'bg-red-400/10', name: 'Flare' },
    // 🦅 THE NATIVE SEAGULL STACK
    SGCN: { color: 'text-teal-400', bg: 'bg-teal-400/20', name: 'SeagullCoin' },
    SGCASH: { color: 'text-amber-400', bg: 'bg-amber-400/20', name: 'SeagullCash' }
  };


  if (!user || !user.balances) return null;

  return (
    <div className="mt-8">
      <h3 className="text-slate-400 text-sm font-medium uppercase tracking-widest mb-4">Your Assets</h3>
      <div className="grid gap-4">
        {Object.entries(user.balances).map(([symbol, amount]) => (
          <div key={symbol} className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex items-center justify-between hover:border-teal-500/50 transition-all cursor-pointer group">
            <div className="flex items-center gap-4">
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${chainStyles[symbol]?.bg || 'bg-slate-800'}`}>
                <Coins className={chainStyles[symbol]?.color || 'text-slate-400'} size={24} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-white font-bold text-lg">{symbol}</span>
                  <span className="text-slate-500 text-xs">{chainStyles[symbol]?.name || 'Native'}</span>
                </div>
                <div className="text-slate-400 font-mono text-sm">
                  {parseFloat(amount.$numberDecimal || amount).toLocaleString()} {symbol}
                </div>
              </div>
            </div>

            <div className="flex flex-col items-end">
              <button className="p-2 rounded-full bg-slate-800 group-hover:bg-teal-500 transition-colors text-slate-400 group-hover:text-white">
                <ArrowUpRight size={20} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default AssetList;

