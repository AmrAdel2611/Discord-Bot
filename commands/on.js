const axios = require('axios');
const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ContainerBuilder,
    MessageFlags,
    SeparatorBuilder,
    SlashCommandBuilder,
    TextDisplayBuilder
} = require('discord.js');

const API_BASE_URL = process.env.IMRP_API_BASE_URL || 'https://api.sa-mp.im/v2/public';
const resultCache = new Map();

const SNIPER_EMOJI_ID = '1555998179739172965';
const SNIPER_EMOJI = `<:sniper:${SNIPER_EMOJI_ID}>`;
const FACTION_EMOJI_IDS = {
    '1': '1555999396162838588', // Corleone
    '2': '1555999398704718086', // Tattaglia
    '3': '1555999401120501854', // Stracci
    '4': null, // Cuneo
    '5': '1555999402579992827', // Barzini
    '6': null, // Paterno
    '7': '1555999404610158702', // San Andreas Police Department
    '8': null, // Hitman
    '10': null, // San Andreas Special Forces
    '11': null, // Government
    '12': null, // Nat. Office of Security Enf.
    '13': null, // The Fake News Agency
    '14': '1555999406141087754', // Kemirov
    '15': null, // Leone
    '16': '1555999407147589693', // DeLeon
    '19': null, // Windsor Inc.
    '25': '1555999393730011157', // Civilian
    '26': null // Marsico
};


async function getJson(path) {
    const response = await axios.get(`${API_BASE_URL}${path}`, { timeout: 10000 });
    return response.data;
}

function getOnlinePlayers(payload) {
    return Array.isArray(payload?.data?.players) ? payload.data.players : [];
}

function getAlliances(payload) {
    return Array.isArray(payload?.data?.alliances) ? payload.data.alliances : [];
}

function getFactionName(player) {
    return player.faction?.abbreviation || player.faction?.name || 'Civilian';
}

function getFactionId(player) {
    return player.faction?.id;
}

function getFactionEmojiId(faction) {
    const factionId = faction.id ?? (faction.name === 'Civilian' ? 25 : null);
    return factionId == null ? undefined : FACTION_EMOJI_IDS[String(factionId)];
}

function groupFactions(factions, alliances) {
    const allianceByFactionId = new Map();
    const allianceByFactionName = new Map();

    for (const alliance of alliances) {
        for (const faction of alliance.factions || []) {
            allianceByFactionId.set(faction.id, alliance.name);
            if (faction.name) {
                allianceByFactionName.set(faction.name.toLowerCase(), alliance.name);
            }
            if (faction.abbreviation) {
                allianceByFactionName.set(faction.abbreviation.toLowerCase(), alliance.name);
            }
        }
    }

    const groupedFactions = new Map();
    const unalliedFactions = [];

    for (const faction of factions) {
        const allianceName = allianceByFactionId.get(faction.id)
            || allianceByFactionName.get(faction.name.toLowerCase());

        if (!allianceName) {
            unalliedFactions.push(faction);
            continue;
        }

        if (!groupedFactions.has(allianceName)) {
            groupedFactions.set(allianceName, []);
        }
        groupedFactions.get(allianceName).push(faction);
    }

    const sections = [...groupedFactions.entries()]
        .sort(([first], [second]) => first.localeCompare(second))
        .map(([name, allianceFactions]) => ({ name, factions: allianceFactions }));

    if (unalliedFactions.length > 0) {
        sections.push({ name: 'Other Factions', factions: unalliedFactions });
    }

    return sections;
}

function isSniper(member, onlinePlayer) {
    const tier = member?.tier ?? onlinePlayer?.tier;
    const explicitSniper = member?.sniper
        ?? member?.is_sniper
        ?? onlinePlayer?.sniper
        ?? onlinePlayer?.is_sniper;

    return Boolean(
        tier === 0
        || tier === 1
        || String(tier).trim() === '0'
        || String(tier).trim() === '1'
        || explicitSniper
    );
}

function getFactionSniperCount(faction) {
    return (faction.players || []).filter(player => isSniper(player, player)).length;
}

function getAllianceStats(factions) {
    return factions.reduce(
        (acc, faction) => {
            acc.players += faction.players.length;
            acc.snipers += getFactionSniperCount(faction);
            return acc;
        },
        { players: 0, snipers: 0 }
    );
}

function addFactionSections(container, sections, factionIndexes) {
    for (const section of sections) {
        container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

        let totalText = '';
        if (section.name !== 'Other Factions') {
            const { players, snipers } = getAllianceStats(section.factions);
            totalText = ` - ${players} ${SNIPER_EMOJI}${snipers}`;
        }

        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`**${section.name}${totalText}**`)
        );

        for (let index = 0; index < section.factions.length; index += 5) {
            const row = new ActionRowBuilder();
            for (const faction of section.factions.slice(index, index + 5)) {
                const snipers = getFactionSniperCount(faction);
                const button = new ButtonBuilder()
                    .setCustomId(`on:faction:${factionIndexes.get(faction)}`)
                    .setLabel(`${faction.name}: ${faction.players.length} (${snipers})`.slice(0, 80))
                    .setStyle(ButtonStyle.Secondary);
                const emojiId = getFactionEmojiId(faction);

                if (emojiId) {
                    button.setEmoji(emojiId);
                }

                row.addComponents(button);
            }
            container.addActionRowComponents(row);
        }
    }
}

function buildOverviewContainer(factions, alliances, total, factionIndexes) {
    const sections = groupFactions(factions, alliances);
    const container = new ContainerBuilder()
        .setAccentColor(0x2ecc71)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`## Italy Mafia Roleplay\n**Online Players: ${total}**`)
        );

    addFactionSections(container, sections, factionIndexes);
    return container;
}

function getCountryFlag(country) {
    if (!country || typeof country !== 'string' || country.length !== 2) {
        return '🌐';
    }

    return country
        .toUpperCase()
        .split('')
        .map(letter => String.fromCodePoint(127397 + letter.charCodeAt(0)))
        .join('');
}

function formatPlayerLine(member, onlinePlayer) {
    const playerName = member.name || onlinePlayer?.name || 'Unknown player';
    return `${getCountryFlag(onlinePlayer?.country)} - \`${playerName}\``;
}

function buildFactionContainer(faction, members, onlinePlayers) {
    const playersById = new Map(onlinePlayers.map(player => [player.id, player]));
    const playersByName = new Map(onlinePlayers.map(player => [player.name, player]));
    const onlineMembers = members.length > 0
        ? members.filter(member => member.online)
        : faction.players;
    const tierGroups = new Map();

    for (const member of onlineMembers) {
        const onlinePlayer = playersById.get(member.id) || playersByName.get(member.name);
        const tier = member.tier ?? onlinePlayer?.tier ?? '?';
        if (!tierGroups.has(tier)) {
            tierGroups.set(tier, []);
        }
        tierGroups.get(tier).push({ member, onlinePlayer });
    }

    const sniperCount = onlineMembers.filter(member => {
        const onlinePlayer = playersById.get(member.id) || playersByName.get(member.name);
        return isSniper(member, onlinePlayer);
    }).length;

    const header = `## ${faction.name}\n-# Player's Online: ${onlineMembers.length} , ${SNIPER_EMOJI} ${sniperCount}`;
    const lines = [];
    const sortedTiers = [...tierGroups.keys()].sort((first, second) => {
        if (first === '?') return 1;
        if (second === '?') return -1;
        return Number(first) - Number(second);
    });

    for (const tier of sortedTiers) {
        lines.push(`Tier ${tier}:`);
        for (const { member, onlinePlayer } of tierGroups.get(tier)) {
            lines.push(formatPlayerLine(member, onlinePlayer));
        }
        lines.push('');
    }

    const details = lines.join('\n').trim() || 'No players are online.';

    return new ContainerBuilder()
        .setAccentColor(0x2ecc71)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(header))
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(details.slice(0, 3800)));
}

function buildErrorContainer() {
    return new ContainerBuilder()
        .setAccentColor(0xe74c3c)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                '## Online Players\n\nThe online player API is currently unavailable. Please try again shortly.'
            )
        );
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('on')
        .setDescription('Shows online players grouped by faction'),

    async execute(interaction) {
        await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

        try {
            const onlinePayload = await getJson('/server/online-players');
            const onlinePlayers = getOnlinePlayers(onlinePayload);
            const factionsByName = new Map();

            for (const player of onlinePlayers) {
                const factionName = getFactionName(player);
                if (!factionsByName.has(factionName)) {
                    factionsByName.set(factionName, {
                        id: getFactionId(player),
                        name: factionName,
                        players: []
                    });
                }
                factionsByName.get(factionName).players.push(player);
            }

            const factions = [...factionsByName.values()];

            // Pre-fetch faction rosters in parallel to attach tier & sniper info to online players
            const factionsWithIds = factions.filter(f => f.id != null);
            const memberResults = await Promise.allSettled(
                factionsWithIds.map(f => getJson(`/factions/${f.id}/members`))
            );

            const memberMap = new Map();
            for (const result of memberResults) {
                if (result.status === 'fulfilled' && Array.isArray(result.value?.data?.members)) {
                    for (const m of result.value.data.members) {
                        if (m.id != null) memberMap.set(`id:${m.id}`, m);
                        if (m.name) memberMap.set(`name:${m.name.toLowerCase()}`, m);
                    }
                }
            }

            // Hydrate player records with tier and sniper flags
            for (const faction of factions) {
                for (const player of faction.players) {
                    const match = memberMap.get(`id:${player.id}`) || memberMap.get(`name:${player.name?.toLowerCase()}`);
                    if (match) {
                        player.tier = match.tier;
                        player.sniper = match.sniper ?? match.is_sniper;
                    }
                }
            }

            const factionIndexes = new Map(factions.map((faction, index) => [faction, index]));
            let alliances = [];
            try {
                const alliancesPayload = await getJson('/alliances');
                alliances = getAlliances(alliancesPayload);
            } catch (error) {
                console.error('Failed to fetch alliances:', error.message);
            }

            const message = await interaction.editReply({
                components: [buildOverviewContainer(factions, alliances, onlinePlayers.length, factionIndexes)],
                flags: MessageFlags.IsComponentsV2
            });

            resultCache.set(message.id, { factions, alliances, onlinePlayers });
            setTimeout(() => resultCache.delete(message.id), 15 * 60 * 1000).unref();
        } catch (error) {
            console.error('Failed to fetch online players:', error.message);
            await interaction.editReply({
                components: [buildErrorContainer()],
                flags: MessageFlags.IsComponentsV2
            });
        }
    },

    async handleButton(interaction) {
        const cachedResult = resultCache.get(interaction.message.id);
        if (!cachedResult) {
            return interaction.reply({
                content: 'This online players panel has expired. Run `/on` again.',
                ephemeral: true
            });
        }

        if (interaction.customId === 'on:back') {
            return interaction.update({
                components: [
                    buildOverviewContainer(
                        cachedResult.factions,
                        cachedResult.alliances,
                        cachedResult.onlinePlayers.length,
                        new Map(cachedResult.factions.map((faction, index) => [faction, index]))
                    )
                ],
                flags: MessageFlags.IsComponentsV2
            });
        }

        const factionIndex = Number(interaction.customId.split(':').pop());
        const faction = cachedResult.factions[factionIndex];
        if (!faction) {
            return interaction.reply({ content: 'That faction is no longer available.', ephemeral: true });
        }

        await interaction.deferReply({
            flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2
        });

        try {
            const factionPayload = await getJson(`/factions/${faction.id}/members`);
            const members = Array.isArray(factionPayload?.data?.members)
                ? factionPayload.data.members
                : [];

            return interaction.editReply({
                components: [buildFactionContainer(faction, members, cachedResult.onlinePlayers)],
                flags: MessageFlags.IsComponentsV2
            });
        } catch (error) {
            console.error(`Failed to fetch ${faction.name} members:`, error.message);
            return interaction.editReply({
                components: [buildFactionContainer(faction, [], cachedResult.onlinePlayers)],
                flags: MessageFlags.IsComponentsV2
            });
        }
    }
};