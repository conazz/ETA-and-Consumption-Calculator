/* ============================================================================
   PREMIUM / BILLING MODULE — eta-calculator-premium
   ============================================================================
   Everything related to the paid "Consumption Pro" unlock lives in this one
   file, deliberately separate from index.html's own script.

   REAL BACKEND — MOCK_MODE is now false. Trial status, premium status, and
   voucher redemption are all verified against the Cloud Functions in
   backend/functions/index.js (Firestore-backed, server-authoritative — see
   that file's own comments for exactly what each endpoint does and why).

   Purchases use the real Digital Goods API + Payment Request API, which
   only exist inside a Play-Store-installed Trusted Web Activity (TWA) — not
   in a plain browser tab or "Add to Home Screen" install. This file
   feature-detects that (`window.getDigitalGoodsService`) rather than
   assuming it's always available, so the exact same file works correctly
   both inside the real TWA (real purchases) and when this same site is
   just visited in an ordinary mobile browser, e.g. as mobile-app (where a
   purchase attempt correctly and gracefully fails, matching mobile-app's
   own "contact the developer" upgrade flow instead of a fake purchase).
   ========================================================================== */
(function(window){
  "use strict";

  // ---- Cloud Functions base URL (see backend/ at the repo root) ----
  var FUNCTIONS_BASE = "https://us-central1-eta-consumption-calculator.cloudfunctions.net";

  // ---- Storage keys (localStorage) ----
  var LS_PREMIUM = "eta-premium-status-v1";       // cached {premium:boolean, checkedAt:number}
  var LS_TRIAL = "eta-premium-trial-v1";          // cached {status:"none"|"active"|"expired", startedAt:number, daysRemaining:number}
  var LS_DEVICE_ID = "eta-device-id-v1";          // random per-install id, sent to the backend instead of any personal identifier

  // The one product this app sells.
  var PRODUCT_ID = "consumption_pro_unlock";

  // Discount ratio for the struck-through "original" price — Play Billing
  // only ever returns your current active price, not a separate "was"
  // price, so the "original" is always derived as currentPrice / (1 - OFF).
  var DISCOUNT_OFF = 0.5; // 50% off

  var MOCK_MODE = false;

  function readJSON(key){
    try{ return JSON.parse(localStorage.getItem(key)); }catch(e){ return null; }
  }
  function writeJSON(key, val){
    try{ localStorage.setItem(key, JSON.stringify(val)); }catch(e){}
  }

  // A random id generated once per install/browser-storage and reused for
  // every backend call — this is what the server tracks trial/premium
  // status by, deliberately not anything tied to a real identity. Clearing
  // site data does generate a fresh one (a real, known limitation — see
  // backend/functions/index.js's header comment), but it at least stops
  // the far more casual "toggle a setting" reset trick.
  function getDeviceId(){
    var id = null;
    try{ id = localStorage.getItem(LS_DEVICE_ID); }catch(e){}
    if(id) return id;
    id = (window.crypto && window.crypto.randomUUID) ? window.crypto.randomUUID() :
      "id-" + Date.now() + "-" + Math.random().toString(16).slice(2);
    try{ localStorage.setItem(LS_DEVICE_ID, id); }catch(e){}
    return id;
  }

  function callFunction(name, body){
    return fetch(FUNCTIONS_BASE + "/" + name, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {})
    }).then(function(res){
      if(!res.ok) throw new Error("Request failed: " + res.status);
      return res.json();
    });
  }

  /* --------------------------------------------------------------------
     Product details / pricing
     -------------------------------------------------------------------- */

  // Uses the real Digital Goods API when running inside the installed TWA;
  // falls back to a plausible static price everywhere else (a plain
  // browser tab, or mobile-app) so the paywall UI still has something
  // sensible to render even where a real purchase could never happen.
  function getProductDetails(){
    if(window.getDigitalGoodsService){
      return window.getDigitalGoodsService("https://play.google.com/billing")
        .then(function(service){ return service.getDetails([PRODUCT_ID]); })
        .then(function(detailsList){
          var d = detailsList[0];
          return {
            productId: d.itemId,
            currency: d.price.currency,
            value: parseFloat(d.price.value),
            formatted: new Intl.NumberFormat(undefined, { style: "currency", currency: d.price.currency }).format(d.price.value)
          };
        })
        .catch(function(){ return mockProductDetails(); });
    }
    return mockProductDetails();
  }
  function mockProductDetails(){
    return Promise.resolve({ productId: PRODUCT_ID, currency: "USD", value: 9.99, formatted: "$9.99" });
  }

  // Pure calculation, not hardcoded — works off whatever getProductDetails()
  // actually returns, so it's correct regardless of the user's local
  // currency.
  function computeOriginalPrice(details){
    var original = details.value / (1 - DISCOUNT_OFF);
    return {
      currency: details.currency,
      value: original,
      formatted: formatCurrencyLike(details.formatted, details.value, original)
    };
  }

  // Best-effort: reuses whatever currency symbol/format Play Billing handed
  // us in `formatted` (e.g. "$9.99") and substitutes the computed original
  // value, rather than inventing our own currency formatting.
  function formatCurrencyLike(sampleFormatted, sampleValue, newValue){
    var sampleValueStr = sampleValue.toFixed(2);
    if(sampleFormatted && sampleFormatted.indexOf(sampleValueStr) !== -1){
      return sampleFormatted.replace(sampleValueStr, newValue.toFixed(2));
    }
    return newValue.toFixed(2);
  }

  /* --------------------------------------------------------------------
     Purchase flow + status
     -------------------------------------------------------------------- */

  // Real purchase flow: Digital Goods API for product details + the
  // standard web Payment Request API to actually collect payment, then the
  // resulting purchase token is verified server-side (verifyPurchase Cloud
  // Function) before Pro is ever unlocked — the client's own "it worked"
  // claim is never trusted alone.
  function purchasePremium(){
    if(!window.getDigitalGoodsService){
      return Promise.resolve({
        success: false,
        message: "Purchases only work inside the installed Play Store app, not in a browser tab."
      });
    }
    var paymentMethod = { supportedMethods: "https://play.google.com/billing", data: { sku: PRODUCT_ID } };
    var request = new PaymentRequest([paymentMethod], {
      total: { label: "Consumption Pro", amount: { currency: "USD", value: "0" } }
    });
    return request.show()
      .then(function(response){
        var purchaseToken = response.details && response.details.purchaseToken;
        return response.complete("success").then(function(){ return purchaseToken; });
      })
      .then(function(purchaseToken){
        if(!purchaseToken) throw new Error("No purchase token returned");
        return callFunction("verifyPurchase", { deviceId: getDeviceId(), purchaseToken: purchaseToken, productId: PRODUCT_ID });
      })
      .then(function(result){
        if(result.success) setPremium(true);
        return result;
      })
      .catch(function(e){
        return { success: false, message: (e && e.message) || "Purchase could not be completed." };
      });
  }

  function setPremium(isPremium){
    writeJSON(LS_PREMIUM, { premium: !!isPremium, checkedAt: Date.now() });
  }

  // Cached locally so the app doesn't need to hit the network on every
  // single check — see refreshPremiumStatus() for the on-launch (and
  // post-purchase/redeem) call that keeps this cache in sync.
  function checkPremiumStatus(){
    var cached = readJSON(LS_PREMIUM);
    return !!(cached && cached.premium);
  }

  // Re-verifies against the real backend. Falls back to whatever was last
  // cached if the network call fails (seafarers routinely have
  // slow/absent connectivity underway) — never wrongly downgrades an
  // already-confirmed Pro user to locked just because they're offline
  // right now, but also never grants access that was never confirmed at
  // least once while online.
  function refreshPremiumStatus(){
    return callFunction("checkPremiumStatus", { deviceId: getDeviceId() })
      .then(function(result){
        setPremium(!!result.premium);
        return checkPremiumStatus();
      })
      .catch(function(){
        return checkPremiumStatus();
      });
  }

  /* --------------------------------------------------------------------
     Free trial — server-checked, not the device clock. Backed by
     backend/functions/index.js's checkTrialStatus/startTrial, keyed by the
     per-install device id above rather than the phone's own clock, so it
     can't be reset by changing the device date or clearing this cache
     alone (see that file's own comments for the one remaining gap:
     uninstall + reinstall generates a fresh device id).
     -------------------------------------------------------------------- */

  function checkTrialStatus(){
    return callFunction("checkTrialStatus", { deviceId: getDeviceId() })
      .then(function(result){
        writeJSON(LS_TRIAL, result);
        return result;
      })
      .catch(function(){
        return readJSON(LS_TRIAL) || { status: "none", startedAt: null, daysRemaining: 0 };
      });
  }

  function startTrial(){
    return callFunction("startTrial", { deviceId: getDeviceId() })
      .then(function(result){
        writeJSON(LS_TRIAL, result);
        return result;
      });
  }

  /* --------------------------------------------------------------------
     Redeem code — validated server-side (backend/functions/index.js's
     redeemVoucher): a hardcoded reusable "TESTCODE" for the developer's
     own testing/comps, plus real one-time codes stored in Firestore for
     actual giveaways.
     -------------------------------------------------------------------- */
  function redeemVoucher(code){
    return callFunction("redeemVoucher", { deviceId: getDeviceId(), code: code })
      .then(function(result){
        if(result.success) setPremium(true);
        return result;
      });
  }

  /* --------------------------------------------------------------------
     Desktop app download link — a real, signed, time-limited Firebase
     Storage URL (backend/functions/index.js's getDesktopDownloadLink),
     issued only after that function re-checks Premium status server-side
     (Premium only, NOT trial — matches the UI's own gating on this
     button). Expiry is a generous 24 hours rather than the 10-15 minutes
     you'd default to for a typical web app, specifically because this
     app's audience is seafarers with slow/intermittent onboard
     connectivity — the UI calls this fresh every tap (never caches a
     link), so there's no downside to trying again later on a stronger
     connection, but a short expiry would actively hurt someone whose
     download drops mid-transfer and resumes hours later.
     -------------------------------------------------------------------- */
  function getDesktopDownloadLink(){
    return callFunction("getDesktopDownloadLink", { deviceId: getDeviceId() })
      .then(function(result){
        if(!result.url) throw new Error(result.error || "Could not get a download link.");
        return result.url;
      });
  }

  /* --------------------------------------------------------------------
     Combined "is this feature unlocked right now" helper — premium OR an
     active trial both unlock the same gated features.
     -------------------------------------------------------------------- */
  function isUnlocked(trialStatus){
    if(checkPremiumStatus()) return true;
    return !!(trialStatus && trialStatus.status === "active");
  }

  window.Premium = {
    PRODUCT_ID: PRODUCT_ID,
    getProductDetails: getProductDetails,
    computeOriginalPrice: computeOriginalPrice,
    purchasePremium: purchasePremium,
    checkPremiumStatus: checkPremiumStatus,
    refreshPremiumStatus: refreshPremiumStatus,
    checkTrialStatus: checkTrialStatus,
    startTrial: startTrial,
    redeemVoucher: redeemVoucher,
    getDesktopDownloadLink: getDesktopDownloadLink,
    isUnlocked: isUnlocked
  };
})(window);
