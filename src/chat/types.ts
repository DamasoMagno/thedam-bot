import type { PermissionsBitField } from 'discord.js';
export interface ChatChannel {
  send(payload: {
    content: string;
    allowedMentions: { parse: never[]; repliedUser: boolean };
  }): Promise<{ id: string }>;
}
export interface ChatMessage {
  id: string;
  guildId: string | null;
  channelId: string;
  content: string;
  author: { id: string; bot?: boolean };
  webhookId?: string | null;
  createdTimestamp?: number;
  mentions?: {
    users: { has(id: string): boolean; size?: number };
    roles?: { size: number };
    everyone?: boolean;
  };
  channel: ChatChannel;
  member?: { permissions: Pick<PermissionsBitField, 'has'> } | null;
  guild?: {
    members: { cache: { get(id: string): { displayName: string } | undefined } };
  } | null;
}
export interface ChatReaction {
  message: Pick<ChatMessage, 'id' | 'guildId' | 'channelId'>;
  emoji: { name: string | null };
}
export interface ChatUser {
  id: string;
  bot?: boolean;
}
export type ConversationMode = 'mention' | 'discreet' | 'participative';
