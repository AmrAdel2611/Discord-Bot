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

function getAllianceTotal(factions) {
    return factions.reduce((total, faction) => total + faction.players.length, 0);
}

function addFactionSections(container, sections, factionIndexes) {
    for (const section of sections) {
        container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

        const totalText = section.name === 'Other Factions'
            ? ''
            : ` - ${getAllianceTotal(section.factions)}`;
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`**${section.name}${totalText}**`)
        );

        for (let index = 0; index < section.factions.length; index += 5) {
            const row = new ActionRowBuilder();
            for (const faction of section.factions.slice(index, index + 5)) {
                row.addComponents(
                    new ButtonBuilder()
                        .setCustomId(`on:faction:${factionIndexes.get(faction)}`)
                        .setLabel(`${faction.name}: ${faction.players.length}`.slice(0, 80))
                        .setStyle(ButtonStyle.Secondary)
                );
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

function isSniper(member, onlinePlayer) {
    return Boolean(
        member.sniper
        ?? member.is_sniper
        ?? onlinePlayer?.sniper
        ?? onlinePlayer?.is_sniper
    );
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
    const header = `## ${faction.name}\n-# Player's Online: ${onlineMembers.length} , Snipers: ${sniperCount}`;
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

        await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

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