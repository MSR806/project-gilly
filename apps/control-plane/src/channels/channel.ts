/** An inbound conversational surface bound to one agent. Slack now; Web/Telegram later. */
export interface Channel {
  readonly name: string;
  /** Begin listening for messages. Resolves once connected. */
  start(): Promise<void>;
}
