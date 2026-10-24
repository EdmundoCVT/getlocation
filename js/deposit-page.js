// Page client du dépôt de garantie : contexte, préautorisation et récupération.
(function () {
  "use strict";

  const status = document.getElementById("depositStatus");
  const details = document.getElementById("depositDetails");
  const recovery = document.getElementById("depositRecovery");
  const recoveryText = document.getElementById("depositRecoveryText");
  const retry = document.getElementById("depositRetry");
  const checkout = document.getElementById("checkoutButton");

  function formatMoney(cents) {
    return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(Number(cents || 0) / 100);
  }

  function formatDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return "";
    return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "long", year: "numeric" }).format(new Date(`${value}T12:00:00Z`));
  }

  function formatDateTime(value) {
    const date = new Date(value || "");
    if (!Number.isFinite(date.getTime())) return "";
    return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "long", year: "numeric" }).format(date);
  }

  function showRecovery(message, canRetry) {
    status.hidden = true;
    status.setAttribute("aria-busy", "false");
    details.hidden = true;
    recovery.hidden = false;
    recoveryText.textContent = message;
    retry.hidden = !canRetry;
  }

  function render(data) {
    document.getElementById("depositReference").textContent = data.reference || "Réservation associée au lien sécurisé";
    document.getElementById("depositVehicle").textContent = data.vehicle && data.vehicle.name ? data.vehicle.name : "Véhicule de la réservation";
    const dates = data.rental && formatDate(data.rental.startDate) && formatDate(data.rental.endDate)
      ? `${formatDate(data.rental.startDate)} — ${formatDate(data.rental.endDate)}`
      : "Dates de la réservation associée";
    document.getElementById("depositDates").textContent = dates;
    document.getElementById("depositAmount").textContent = formatMoney(data.amountCents);

    const validity = document.getElementById("depositValidity");
    if (data.authorizationExpiresAt) {
      validity.textContent = `L’autorisation bancaire est prévue jusqu’au ${formatDateTime(data.authorizationExpiresAt)}. Elle peut être libérée plus tôt après la restitution.`;
    } else if (data.linkExpiresAt) {
      validity.textContent = `Ce lien sécurisé est utilisable jusqu’au ${formatDateTime(data.linkExpiresAt)}. La durée de l’autorisation dépend ensuite de la banque.`;
    } else {
      validity.textContent = "La durée de l’autorisation dépend de la banque et des conditions indiquées par Mollie.";
    }

    status.hidden = true;
    status.setAttribute("aria-busy", "false");
    recovery.hidden = true;
    details.hidden = false;

    if (["authorized", "paid"].includes(data.status)) {
      checkout.hidden = true;
      status.hidden = false;
      status.classList.add("is-success");
      status.textContent = "Votre dépôt de garantie a bien été autorisé. Aucune nouvelle action n’est nécessaire.";
      return;
    }

    checkout.href = data.checkoutUrl;
    checkout.hidden = false;
  }

  async function loadDeposit() {
    const token = new URL(window.location.href).searchParams.get("token");
    if (!token) {
      showRecovery("Ce lien de dépôt est invalide. Demandez un nouveau lien sécurisé à GET LOCATION.", false);
      return;
    }

    status.hidden = false;
    status.classList.remove("is-success");
    status.setAttribute("aria-busy", "true");
    status.textContent = "Vérification du lien et du montant du dépôt…";
    recovery.hidden = true;

    try {
      const response = await fetch(`/api/deposit-checkout?token=${encodeURIComponent(token)}`, {
        credentials: "omit",
        referrerPolicy: "no-referrer"
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const expired = response.status === 404;
        showRecovery(
          expired
            ? "Ce lien sécurisé est invalide ou expiré. Demandez un nouveau lien à GET LOCATION."
            : "Les informations du dépôt sont momentanément indisponibles. Aucun débit n’a été effectué. Réessayez ou contactez GET LOCATION.",
          !expired
        );
        return;
      }
      if (!data.checkoutUrl && !["authorized", "paid"].includes(data.status)) {
        showRecovery("La page d’autorisation n’est plus disponible. Aucun débit n’a été effectué. Contactez GET LOCATION pour recevoir un nouveau lien.", false);
        return;
      }
      render(data);
    } catch (_error) {
      showRecovery("Impossible de vérifier le dépôt pour le moment. Aucun débit n’a été effectué. Vérifiez votre connexion puis réessayez.", true);
    }
  }

  if (retry) retry.addEventListener("click", loadDeposit);
  if (checkout) checkout.addEventListener("click", function () {
    checkout.classList.add("loading");
    checkout.setAttribute("aria-disabled", "true");
    checkout.textContent = "Ouverture de la page sécurisée Mollie…";
  });

  loadDeposit();
}());
