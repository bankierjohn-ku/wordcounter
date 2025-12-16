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
        let imageBuffer = req.file.buffer;
        let mediaType = req.file.mimetype || 'image/jpeg';
        
        // Convert to JPEG and resize if needed
        let quality = 90;
        let maxWidth = 2000;
        
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
            if (quality > 60) {
                quality -= 10;
            } else if (maxWidth > 1000) {
                maxWidth -= 200;
                quality = 90;
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
                        text: 'Please transcribe all the handwritten text you see in this image. After transcribing, count the total number of words and provide your response in this exact format:\n\nWORD COUNT: [number]\n\nTRANSCRIPTION:\n[the full transcribed text]'
                    }
                ]
            }]
        });

        // Parse Claude's response
        const responseText = message.content[0].text;
        
        // Extract word count and transcription
        const wordCountMatch = responseText.match(/WORD COUNT:\s*(\d+)/i);
        const transcriptionMatch = responseText.match(/TRANSCRIPTION:\s*([\s\S]*)/i);
        
        const wordCount = wordCountMatch ? parseInt(wordCountMatch[1]) : 0;
        const transcription = transcriptionMatch ? transcriptionMatch[1].trim() : responseText;

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
