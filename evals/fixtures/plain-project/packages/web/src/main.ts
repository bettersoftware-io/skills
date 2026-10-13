const page = document.querySelector<HTMLElement>("#order");
const id = new URLSearchParams(location.search).get("order") ?? "";

const response = await fetch(`http://localhost:4000/orders/${encodeURIComponent(id)}`);

if (page !== null) {
  page.textContent = response.ok ? JSON.stringify(await response.json()) : "No such order.";
}
