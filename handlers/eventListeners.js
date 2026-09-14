const fs = require('fs');
require('dotenv').config();

const allowedChannels = [process.env.CHANNEL_LOAD_ID_1, process.env.CHANNEL_LOAD_ID_2];

// Function to normalize resource amounts
function normalizeAmount(amount) {
    if (typeof amount !== "string") {
        amount = amount.toString(); // Convert number to string if necessary
    }

    amount = amount.toLowerCase().replace(/,/g, ""); // Remove commas if present

    // If "k" is present, multiply by 1,000
    if (amount.includes("k")) {
        return parseInt(amount.replace("k", " ")) * 1000;
    }

    // If the number is already large (above 1,000), return as-is
    const numericAmount = parseInt(amount);
    return numericAmount >= 1000 ? numericAmount : numericAmount * 1000;
}
function formatAmount(amount) {
    return amount >= 1000 ? amount.toLocaleString() : amount; // Format numbers with commas
}

module.exports = {
    name: 'messageCreate',
    async execute(message) {
        // Ignore messages from bots & messages outside allowed channels
        if (message.author.bot || !allowedChannels.includes(message.channel.id)) {
            return;
        }

        console.log(`Message received: ${message.content}`); // Debugging
        console.log(`Processing message in allowed channel: ${message.channel.id}`);

        const content = message.content.trim().replace(/–/g, '-'); // Normalize dashes


        // Match formats
        const contentLower = content.toLowerCase(); // Convert message to lowercase

        const leadMatch = contentLower.match(/^Player name:\s*(.+)\nAmount of lead Loaded:\s*([\d.]+k?)\nDate and time:\s*(.+)$/i);
        const metalMatch = contentLower.match(/^player name:\s*(.+)\namount of metal loaded:\s*([\d.]+k?)\nDate and time:\s*(.+)$/i);



        console.log(`Raw Message: "${message.content}"`);
        console.log(`Processed Message (Trimmed & Escaped): "${message.content.replace(/\n/g, '\\n')}"`);

        if (!leadMatch && !metalMatch) {
            console.log("No valid match found, skipping message.");
            return;
        } // Ignore unrelated messages

        

        // Extract data
        const playerName = leadMatch ? leadMatch[1] : metalMatch[1];
        const amountLoaded = normalizeAmount(leadMatch ? leadMatch[2] : metalMatch[2]);
        const resourceType = leadMatch ? 'lead' : 'metal';
        const dateTime = leadMatch ? leadMatch[3] : metalMatch[3]; // ✅ Extracted DateTime

        const confirmUserId = process.env.CONFIRMER_ID_1; // Replace with actual confirmation user's ID

        // Send confirmation message before saving data
        const confirmationChannel = message.guild.channels.cache.get(process.env.CONFIRMATION_CHANNEL); // Replace with actual channel ID
        

        if (!confirmationChannel) {
            return message.reply("❌ Error: The confirmation channel was not found.");
        }
        const confirmationMessage = await confirmationChannel.send(`
            **New Resource Entry Detected** 🛠\n- **Player Name:** ${playerName}\n- **Resource Type:** ${resourceType}\n- **Amount Loaded:** ${formatAmount(amountLoaded)}\n- **Date & Time:** ${dateTime}\n✅ **Waiting for confirmation from<@${confirmUserId}>...**
        `);
        await confirmationMessage.react("✅").then(() => console.log("✅ Bot Reaction added successfully"));
        await confirmationMessage.react("❌").then(() => console.log("❌ Bot Reaction added successfully"));

        const filter = (reaction, user) => {
            console.log(`🔍 Reaction detected from ${user.username}: ${reaction.emoji.name}`);
            return (reaction.emoji.name === "✅" || reaction.emoji.name === "❌") && user.id === confirmUserId;
        };                
        
        confirmationMessage.awaitReactions({ filter, max: 1, time: 86400000 })
            .then(collected => {
                console.log("✅ Collected reactions:", collected);
                const reaction = collected.first();

                if (reaction.emoji.name === "✅") {
                    console.log(`✅ Confirmation received, processing entry...`);
        
                    // Debug log to check if JSON update is happening
                    console.log("🔍 Attempting to save data...");

                    // Read existing data
                    let playerData = {};
                    if (fs.existsSync("./player_data.json")) {
                        playerData = JSON.parse(fs.readFileSync("./player_data.json"));
                        console.log("📁 Successfully read player_data.json"); // Debug log
                    }

                    // Ensure player entry exists
                    if (!playerData[message.author.id]) {
                        playerData[message.author.id] = { username: `<@${message.author.id}>`, lead: 0, metal: 0 };
                    }

                    playerData[message.author.id][resourceType] += parseInt(amountLoaded);

                    // Save updated data
                    fs.writeFileSync("./player_data.json", JSON.stringify(playerData, null, 2));
                    console.log("💾 Data successfully saved to player_data.json!"); // Debug log
                    
                    async function confirmAndReact() {
                        await confirmationMessage.reply(`✅ **Entry confirmed and saved!**`);
                        await message.react("✅"); // Reacts to the original user message

                        // Sends confirmation message in the original Channel
                        if (resourceType === 'lead') { 
                            // Sends Lead confirmation message in the original Channel
                            console.log("🔹 Lead resource detected!");

                            message.reply(`📦 **Added Lead!** 📦\n- **User:** ${playerName}\n  - Amount Added: ${formatAmount(amountLoaded)}\n  - New Total: ${formatAmount(playerData[message.author.id].lead)}`);
                        } else if (resourceType === 'metal') {
                            // Sends Metal confirmation message in the original Channel
                            console.log("🔸 Metal resource detected!");

                            message.reply(`🪨 **Added Metal!** 🪨\n- **User:** ${playerName}\n  - Amount Added: ${formatAmount(amountLoaded)}\n  - New Total: ${formatAmount(playerData[message.author.id].metal)}`);
                        }
                    }
                    
                    confirmAndReact(); // ✅ Call the async function
                
                } else if (reaction.emoji.name === "❌") {
                    console.log(`❌ Entry canceled by ${confirmUserId}`);

                    async function DenyAndReact() {
                        await confirmationMessage.edit(`❌ **Entry denied and didn't get saved!**`);
                        await message.react("❌"); // Reacts to the original user message
                    }

                    DenyAndReact()
                }
            })
            .catch(() => confirmationMessage.edit("❌ **No confirmation received. Entry was not saved.**"));
    }
};



