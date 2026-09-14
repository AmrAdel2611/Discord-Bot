const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fs = require('fs');

// Helper to format "YYYY-MM-DD HH:MM:SS" directly to "DD.MM.YYYY at HH:MM"
function formatImrpDate(rawDateString) {
  if (!rawDateString || typeof rawDateString !== 'string') return '`Unknown`';

  const [datePart, timePart] = rawDateString.trim().split(' ');
  if (!datePart) return `\`${rawDateString}\``;

  const [year, month, day] = datePart.split('-');
  const [hour, minute] = (timePart || '00:00').split(':');

  if (!year || !month || !day) return `\`${rawDateString}\``;

  return `\`${day}.${month}.${year} at ${hour}:${minute}\``;
}

const { getCommandRole } = require('../utils/guildConfig');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('listcadets')
    .setDescription('Check the last online status for all cadets in invite_logs.json'),

  async execute(interaction) {
    // 0. Check if the user has the required role
    const roleId = getCommandRole(interaction.guildId, 'listcadets');
        if (!roleId) {
            return interaction.reply({
                content: 'The `/listcadets` command has not been configured for this server.',
                ephemeral: true
            });
        }

        if (!interaction.member.roles.cache.has(roleId)) {
            return interaction.reply({
                content: 'You do not have the role required to use `/listcadets`.',
                ephemeral: true
            });
        }

    await interaction.deferReply();

    

    // 1. Verify and read invite_logs.json
    if (!fs.existsSync('./invite_logs.json')) {
      return interaction.editReply({ content: 'Could not find `invite_logs.json` in the bot directory.' });
    }

    let inviteLogs;
    try {
      inviteLogs = JSON.parse(fs.readFileSync('./invite_logs.json', 'utf8'));
    } catch (err) {
      return interaction.editReply({ content: 'Failed to read or parse `invite_logs.json`.' });
    }

    const logSource = inviteLogs.processed || inviteLogs;
    const cadets = Object.values(logSource)
      .filter(cadet => typeof cadet.name === 'string' && cadet.name.trim().length > 0);

    if (cadets.length === 0) {
      return interaction.editReply({ content: 'No cadet records found in `invite_logs.json`.' });
    }

    // 2. Read token from environment
    const IMRP_TOKEN = process.env.IMRP_ACCESS_TOKEN;
    if (!IMRP_TOKEN) {
      return interaction.editReply({ content: '`IMRP_ACCESS_TOKEN` is missing from your `.env` file.' });
    }

    try {
      // 3. Query faction members
      const response = await fetch('https://api.sa-mp.im/v2/faction/members', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${IMRP_TOKEN}`,
          'Accept': 'application/json'
        }
      });

      if (response.status === 401 || response.status === 403) {
        return interaction.editReply({
          content: 'API error: Token expired, invalid, or lacking faction permissions.'
        });
      }

      if (!response.ok) {
        return interaction.editReply({
          content: `API returned error status: ${response.status} (${response.statusText})`
        });
      }

      const rawJson = await response.json();

      if (rawJson.error || rawJson.message) {
        return interaction.editReply({
          content: `IMRP Error: ${rawJson.error || rawJson.message}`
        });
      }

      // 4. Recursive deep extraction to map all members
      const memberMap = new Map();

      function findMembers(obj) {
        if (!obj || typeof obj !== 'object') return;

        if (typeof obj.name === 'string' && (obj.rank !== undefined || obj.last_seen_at !== undefined || obj.online !== undefined)) {
          const key = obj.name.toLowerCase().replace(/\s+/g, '_').trim();
          memberMap.set(key, obj);
          return;
        }

        const values = Array.isArray(obj) ? obj : Object.values(obj);
        for (const val of values) {
          if (val && typeof val === 'object') {
            findMembers(val);
          }
        }
      }

      findMembers(rawJson);

      // 5. Build comparison list
      const lines = cadets.map(c => {
        const cadetName = c.name || 'Unknown';
        const lookupKey = cadetName.toLowerCase().replace(/\s+/g, '_').trim();
        const liveUser = memberMap.get(lookupKey);
        const trainingStatus = c.trainings || 'TBD';
        const ctoStatus = c.ctoExam || 'TBD';
        const invitedDate = c.date || 'N/A';

        if (!liveUser) {
          return `• **${cadetName}** (Invited: \`${invitedDate}\`)\n  └ Status: ❌ *Not in faction (Kicked / Left)*\n  └ Trainings: **${trainingStatus}** | CTO Exam: **${ctoStatus}**`;
        }

        if (liveUser.online) {
          return `• **${cadetName}** (Invited: \`${invitedDate}\`)\n  └ Status: 🟢 **Online now** | Played 2w: \`${liveUser.hours_played_last_2_weeks}h\`\n  └ Trainings: **${trainingStatus}** | CTO Exam: **${ctoStatus}**`;
        }

        const formattedDate = formatImrpDate(liveUser.last_seen_at);

        return `• **${cadetName}** (Invited: \`${invitedDate}\`)\n  └ Last Seen: ${formattedDate} | Played 2w: \`${liveUser.hours_played_last_2_weeks}h\`\n  └ Trainings: **${trainingStatus}** | CTO Exam: **${ctoStatus}**`;
      });

      // 6. Deliver response via Embed
      const embed = new EmbedBuilder()
        .setTitle('Cadet Activity Status')
        .setDescription(lines.join('\n\n').slice(0, 4096))
        .setColor(0x3498db)
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

    } catch (err) {
      console.error('Cadet command error:', err);
      await interaction.editReply({ content: `An error occurred: ${err.message}` });
    }
  }
};