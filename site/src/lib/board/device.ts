// Which wallet the board page shows first (showcase-site task 37).
//
// The decision is made on the device from what the browser says about itself. Nothing is sent
// anywhere. The function takes its inputs as arguments so it is a pure function: the page reads
// `navigator` and passes the values in, and a prerender, where there is no `navigator`, passes
// nothing and gets "both".

/** The wallet buttons to show: one phone's wallet, or both. */
export type DeviceWallet = 'apple' | 'google' | 'both';

export interface DeviceInputs {
  /** `navigator.userAgent`. */
  readonly userAgent?: string | undefined;
  /** `navigator.userAgentData?.platform` where the browser has it (Chromium). */
  readonly platform?: string | undefined;
  /** `navigator.userAgentData?.mobile` where the browser has it. */
  readonly mobile?: boolean | undefined;
}

/**
 * An iPhone or iPod shows only Apple Wallet. An Android phone shows only Google Wallet. A
 * computer, an iPad (iPadOS Safari reports a Mac), an Android tablet, or anything not clearly
 * one of the two shows both, so a wallet is never hidden on a guess.
 */
export function walletForDevice(inputs: DeviceInputs = {}): DeviceWallet {
  const ua = inputs.userAgent ?? '';
  if (/iPhone|iPod/.test(ua)) {
    return 'apple';
  }
  if (inputs.platform === 'Android' && inputs.mobile === true) {
    return 'google';
  }
  // Without client hints, an Android phone says "Android" and "Mobile"; a tablet only the first.
  if (inputs.platform === undefined && /Android/.test(ua) && /Mobile/.test(ua)) {
    return 'google';
  }
  return 'both';
}
