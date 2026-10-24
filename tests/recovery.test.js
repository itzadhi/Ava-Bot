import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { BANNED_ADMIN_PERMISSIONS } from '../scripts/recover-permissions.js';
import { PermissionFlagsBits } from 'discord.js';

describe('Phase C: Permission Recovery Safety Rules', () => {
  test('BANNED_ADMIN_PERMISSIONS includes all dangerous Discord permissions', () => {
    const dangerous = [
      PermissionFlagsBits.Administrator,
      PermissionFlagsBits.ManageGuild,
      PermissionFlagsBits.ManageRoles,
      PermissionFlagsBits.ManageChannels,
      PermissionFlagsBits.ManageWebhooks,
      PermissionFlagsBits.KickMembers,
      PermissionFlagsBits.BanMembers,
      PermissionFlagsBits.MentionEveryone,
      PermissionFlagsBits.ManageMessages,
      PermissionFlagsBits.ModerateMembers
    ];

    for (const flag of dangerous) {
      assert.equal(
        (BANNED_ADMIN_PERMISSIONS & flag) === flag,
        true,
        `Flag ${flag} must be blocked from baseline recovery`
      );
    }
  });

  test('Ordinary community baseline does not overlap with any banned admin permission', () => {
    const ordinary = (
      PermissionFlagsBits.ViewChannel |
      PermissionFlagsBits.SendMessages |
      PermissionFlagsBits.SendMessagesInThreads |
      PermissionFlagsBits.AddReactions |
      PermissionFlagsBits.ReadMessageHistory |
      PermissionFlagsBits.EmbedLinks |
      PermissionFlagsBits.AttachFiles |
      PermissionFlagsBits.UseExternalEmojis |
      PermissionFlagsBits.Connect |
      PermissionFlagsBits.Speak |
      PermissionFlagsBits.CreatePublicThreads |
      PermissionFlagsBits.UseApplicationCommands
    );

    assert.equal(
      (ordinary & BANNED_ADMIN_PERMISSIONS) === 0n,
      true,
      'Ordinary community permissions must have ZERO overlap with banned admin flags'
    );
  });
});
