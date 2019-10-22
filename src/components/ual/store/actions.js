import { processDacNameInId, processFromDacId } from "imports/validators";

export async function renderLoginModal({ state, commit, dispatch }) {
  commit("setShouldRenderLoginModal", true);
}

export async function logout({ state, commit, dispatch }) {
  let activeAuth = state.activeAuthenticator;
  if (activeAuth) {
    console.log(`Logging out from authenticator: ${activeAuth.getStyle().text}`);
    activeAuth
      .logout()
      .then(() => {
        console.log("Logged out!");
        commit("setActiveAuthenticator", false);
        commit("setAccountName", false);
        commit("setSESSION", { accountName: null, authenticatorName: null });
      })
      .catch(e => {
        console.log(`An error occured while attempting to logout from authenticator: ${activeAuth.getStyle().text}`);
      });
  } else {
    console.log("No active authenticator found, you must be logged in before logging out.");
  }
}

export async function waitForAuthenticatorToLoad({}, authenticator) {
  return new Promise(resolve => {
    if (!authenticator.isLoading()) {
      resolve();
      return;
    }
    const authenticatorIsLoadingCheck = setInterval(() => {
      if (!authenticator.isLoading()) {
        clearInterval(authenticatorIsLoadingCheck);
        resolve();
      }
    }, 250);
  });
}
export async function attemptAutoLogin({ state, commit, dispatch }) {
  let { accountName, authenticatorName, timestamp } = state.SESSION;
  if (accountName && authenticatorName) {
    let authenticator = state.UAL.authenticators.find(a => a.getStyle().text == authenticatorName);
    authenticator.init();
    await dispatch("waitForAuthenticatorToLoad", authenticator);
    if (authenticator.initError) {
      console.log(
        `Attempt to auto login with authenticator ${authenticatorName} failed because it's not available anymore.`
      );
      commit("setSESSION", { accountName: null, authenticatorName: null });
      return;
    }
    authenticator
      .login(accountName)
      .then(() => {
        commit("setSESSION", { accountName, authenticatorName });
        commit("setAccountName", accountName);
        commit("setActiveAuthenticator", authenticator);
      })
      .catch(e => {
        commit("setSESSION", { accountName: null, authenticatorName: null });
        console.log("auto login error", e, e.cause);
      });
  }
}

export function prepareDacTransact({ state, dispatch }, payload) {
  const { accountName } = state;
  const { stepsData, payTokenSymbol } = payload;
  
  const { dacName, dacDescription, tokenSymbol } = stepsData[1];
  const { maxSupply, decimals, issuance } = stepsData[2];
  const {
    lockupAsset, // lockup asset (it was done with auto propositions) wasn't a number, replaced with simple data field
    requestPay,
    lockup,
    lockupSelect,
    periodLength,
    numberElected,
    thresholdHigh,
    thresholdMed,
    thresholdLow,
    maxVotes,
    voteQuorumPercent
  } = stepsData[3];
  const { websiteURL, logoURL, logoMarkURL, color } = stepsData[4]; // how to set up this color into colors?
  
  const lockupSeconds = lockupSelect === "Day(s)" ? lockup * 24 * 3600 : lockup * 3600;
  const contract = process.env.KASDAC_TOKEN_CONTRACT;
  const tokenToPay = process.env[`${payTokenSymbol}_TOKEN_CONTRACT`];

  const dacId = processDacNameInId(dacName);
  // TODO remove || 1 after proper validation will be added to fields
  const memo = {
    id: dacId,
    owner: accountName,
    appointed_custodian: accountName,
    authority: processFromDacId(dacId, 'authority'),
    treasury: processFromDacId(dacId, 'treasury'),
    symbol: {
      contract,
      symbol: `${decimals},${tokenSymbol}`
    },
    max_supply: `${(maxSupply || 1).toFixed(decimals)} ${tokenSymbol}`,
    issuance: `${(issuance || 1).toFixed(decimals)} ${tokenSymbol}`,
    name: dacName,
    description: dacDescription,
    homepage: websiteURL,
    logo_url: logoURL,
    logo_notext_url: logoMarkURL,
    background_url: "",
    theme: {
      is_dark: true,
      colors: {
        $warning: "#f2e285",
        primary: "#ba5f34",
        bg1: "#1f130d",
        bg2: "#574943",
        text1: "rgba(255,255,255,0.9)",
        text2: "rgba(255,255,255,0.7)",
        info: "#4583ba",
        positive: "#21ba45",
        negative: "#db2828",
        dark: "#3d2d27"
      }
    },
    custodian_config: {
      lockupasset: {
        quantity: `${(lockupAsset || 1).toFixed(decimals)} ${tokenSymbol}`,
        contract
      },
      maxvotes: maxVotes,
      numelected: numberElected,
      periodlength: periodLength,
      should_pay_via_service_provider: false,
      initial_vote_quorum_percent: 1,
      vote_quorum_percent: voteQuorumPercent,
      auth_threshold_high: thresholdHigh,
      auth_threshold_mid: thresholdMed,
      auth_threshold_low: thresholdLow,
      lockup_release_time_delay: lockupSeconds,
      requested_pay_max: {
        quantity: `${(requestPay || 1).toFixed(4)} EOS`,
        contract: "eosio.token"
      }
    },
    proposals_config: {
      proposal_threshold: 4,
      finalize_threshold: 1,
      escrow_expiry: 2592000,
      approval_expiry: 2592000
    }
  };

  const actions = [
    {
      account: tokenToPay,
      name: "transfer",
      data: {
        from: this.getAccountName,
        to: "piecesnbitss",
        quantity: `1.0000 ${payTokenSymbol}`,
        memo: JSON.stringify(memo)
      }
    }
  ];
  dispatch("transact", { actions });
}

export async function transact({ state, dispatch, commit }, payload) {
  //check if logged in before transacting
  if (!state.activeAuthenticator || !state.accountName) {
    dispatch("renderLoginModal");
    return;
  }
  commit("setSigningOverlay", { show: true, status: 0, msg: "Waiting for Signature" });
  const user = state.activeAuthenticator.users[0];
  const actions = { ...payload.actions[0] };

  //add authorization to act ions if not supplied
  if (!actions.authorization) {
    actions.authorization = [{ actor: user.accountName, permission: "active" }];
  }

  //sign
  try {
    let res = await user.signTransaction({ actions: [actions] }, { broadcast: true });
    console.log(res);
    commit("setSigningOverlay", { show: true, status: 1, msg: "Transaction Successful" });
    dispatch("hideSigningOverlay", 1000);
    return res;
  } catch (e) {
    console.log(e, e.cause);
    commit("setSigningOverlay", { show: true, status: 2, msg: await dispatch("parseUalError", e) });
    dispatch("hideSigningOverlay", 2000);
    return false;
  }
}

export async function parseUalError({}, error) {
  let cause = "unknown cause";
  let error_code = "";
  if (error.cause) {
    cause = error.cause.reason || error.cause.message || "Report this error to the eosdac devs to enhance the UX";
    error_code = error.cause.code || error.cause.errorCode;
  }
  return `${error}. ${cause} ${error_code}`;
}

export async function hideSigningOverlay({ commit }, ms = 10000) {
  await new Promise(resolve => {
    setTimeout(resolve, ms);
  });
  commit("setSigningOverlay", { show: false, status: 0 });
}
