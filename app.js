
async function swap() {
    const fromPool = document.getElementById('fromPool').value;
    const toPool = document.getElementById('toPool').value;
    const amount = parseFloat(document.getElementById('amount').value);

    const response = await fetch('http://localhost:3000/api/swap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            userId: 1,
            fromPool,
            toPool,
            amount
        })
    });

    const data = await response.json();
    document.getElementById('result').innerText = JSON.stringify(data, null, 2);
}
