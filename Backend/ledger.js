
let balances = {
    1: { xrp_pool: 100000, flr_pool: 100000, xdc_pool: 100000 }
};

let treasury = { xrp_pool: 0, flr_pool: 0, xdc_pool: 0 };

function executeSwap(userId, fromPool, toPool, amount) {
    const user = balances[userId];
    if (!user) return { success: false, message: "User not found" };

    if (user[fromPool] < amount) {
        return { success: false, message: "Insufficient balance" };
    }

    const feePercent = 0.025;
    const fee = amount * feePercent;
    const received = amount - fee;

    user[fromPool] -= amount;
    user[toPool] += received;
    treasury[fromPool] += fee;

    return {
        success: true,
        balances: user,
        fee: fee
    };
}

module.exports = { executeSwap };
