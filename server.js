const express = require('express');
const multer = require('multer');
const Anthropic = require('@anthropic-ai/sdk');
const path = require('path');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

// Initialize Anthropic client
const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY
});

// Serve static files
app.use(express.static('.'));

// Analyze endpoint
app.post('/analyze', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No image uploaded' });
        }

        // Convert image to base64
        const base64Image = req.file.buffer.toString('base64');
        
        // Determine media type
        let mediaType = 'image/jpeg';
        if (req.file.mimetype) {
            mediaType = req.file.mimetype;
        }

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