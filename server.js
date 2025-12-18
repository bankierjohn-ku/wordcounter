const express = require('express');
const multer = require('multer');
const Anthropic = require('@anthropic-ai/sdk');
const sharp = require('sharp');

const app = express();
const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 } // 50MB upload limit
});

// Initialize Anthropic client
const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY
});

// Serve static files from public directory
app.use(express.static('public'));

// Analyze endpoint
app.post('/analyze', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No image uploaded' });
        }

        // Process and compress image to ensure it's under 5MB
        // Use higher quality to preserve handwriting details
        let imageBuffer = req.file.buffer;
        let mediaType = req.file.mimetype || 'image/jpeg';
        
        // Convert to JPEG with high quality
        let quality = 95; // Start with very high quality
        let maxWidth = 3000; // Allow larger images
        
        // Keep trying with lower quality/size until under 5MB
        while (true) {
            const processedBuffer = await sharp(imageBuffer)
                .resize(maxWidth, null, { 
                    fit: 'inside', 
                    withoutEnlargement: true 
                })
                .jpeg({ quality })
                .toBuffer();
            
            // Check if under 5MB (with some buffer room)
            if (processedBuffer.length < 4.5 * 1024 * 1024) {
                imageBuffer = processedBuffer;
                mediaType = 'image/jpeg';
                break;
            }
            
            // Reduce quality or size and try again
            if (quality > 80) {
                quality -= 5; // Smaller steps to maintain quality
            } else if (maxWidth > 1500) {
                maxWidth -= 300;
                quality = 95;
            } else {
                return res.status(400).json({ 
                    error: 'Image too large to process. Please use a smaller image.' 
                });
            }
        }

        // Convert to base64
        const base64Image = imageBuffer.toString('base64');

        // Call Claude API
        const message = await anthropic.messages.create({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 4000,
            messages: [{
                role: 'user',
                content: [
                    {
                        type: 'image',
                        source: {
                            type: 'base64',
                            media_type: mediaType,
                            data: base64Image
                        }
                    },
                    {
                        type: 'text',
                        text: `You are transcribing handwritten text. This is CRITICAL: You must transcribe EXACTLY what is written, preserving every word, spelling error, grammar mistake, and punctuation exactly as it appears. Do NOT correct anything. Do NOT fix spelling. Do NOT improve grammar. Do NOT add or remove words.

After transcribing, count the total number of words very carefully. Count every single word, including small words like "a", "the", "I", etc.

Provide your response in this exact format:

WORD COUNT: [number]

TRANSCRIPTION:
[the full transcribed text exactly as written]`
                    }
                ]
            }]
        });

        // Parse Claude's response
        const responseText = message.content[0].text;
        
        // Extract transcription
        const transcriptionMatch = responseText.match(/TRANSCRIPTION:\s*([\s\S]*)/i);
        const transcription = transcriptionMatch ? transcriptionMatch[1].trim() : responseText;
        
        // Count words ourselves instead of trusting Claude's count
        // Split on whitespace and filter out empty strings
        const words = transcription.trim().split(/\s+/).filter(word => word.length > 0);
        const wordCount = words.length;

        res.json({
            wordCount,
            transcription
        });

    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ 
            error: 'Failed to process image. Please try again.' 
        });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
