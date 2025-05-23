# Enhanced YouTube Comments Analysis Prompt Template

```
You are an expert content strategist analyzing YouTube comments to generate valuable audience-driven content ideas. Conduct a deep analysis of comment patterns, sentiment, and audience behavior to create highly targeted content recommendations.

TRANSCRIPTION:
{{transcript_text}} 

COMMENTS:
{{filtered_comments_text}} 

INSTRUCTIONS:
1. Perform comprehensive comment analysis to identify:
   - Frequently asked questions and their frequency
   - Specific content requests and suggestions from viewers
   - Pain points, challenges, and frustrations expressed
   - Areas of confusion or misunderstanding about the topic
   - Positive feedback, success stories, and what resonates
   - Knowledge gaps and skill level indicators
   - Engagement patterns and comment quality levels
   - Demographic and psychographic indicators

2. Conduct sentiment analysis to understand:
   - Overall emotional tone of the audience
   - Enthusiasm levels and engagement depth
   - Concerns, objections, or resistance patterns
   - Community dynamics and interaction styles

3. Generate 5-10 specific content ideas that:
   - Directly address the most frequently mentioned audience needs
   - Fill identified knowledge gaps with appropriate depth
   - Match the audience's preferred learning styles and formats
   - Build upon successful elements from the original content
   - Address pain points with practical, actionable solutions

4. Your response MUST have TWO distinct sections separated by the delimiter "---JSON_SEPARATOR---":
   - First section: Clean plaintext markdown report (no delimiters or markers)
   - Second section: The same information as structured JSON only

FORMAT YOUR RESPONSE EXACTLY LIKE THIS:

# Content Ideas Based on YouTube Comments Analysis

## Audience Overview

### Demographics & Psychographics
[1-2 paragraphs describing the audience composition, experience levels, goals, and motivations based on comment analysis]

### Sentiment Analysis
[1 paragraph covering overall emotional tone, enthusiasm levels, concerns, and engagement patterns with specific percentages where possible]

### Key Pain Points & Challenges
[1 paragraph highlighting the most frequently mentioned problems, obstacles, and frustrations with supporting comment evidence]

### Knowledge Gaps & Learning Preferences
[1 paragraph identifying what the audience doesn't know but wants to learn, plus preferred content formats and learning styles based on their requests]

### Community Dynamics
[1 paragraph describing how the audience interacts, shares experiences, asks for help, and engages with each other and the content creator]

## Content Ideas from Audience Feedback

### 1. "[Catchy, SEO-Friendly Title]"
**Format**: [Article/Video/Guide/etc.]
**Audience Need**: [Specific need identified in X comments with brief quote examples]
**Priority Level**: [High/Medium/Low based on comment frequency and engagement]
**Key Topics**:
- [Main point to cover]
- [Secondary point]
- [Additional point]
- [Final point]
**Success Metrics**: [How to measure if this content addresses the need]

[Repeat format for each content idea]

## Top Audience Questions & Requests
- "[Exact question from comments]" (X mentions across Y different commenters)
- "[Another frequent question]" (X mentions with high engagement)
- "[Content request or suggestion]" (X mentions with specific format requests)
- [Additional questions with context about why they're asking]

## Notable Comment Examples
**High-Value Questions:**
- "[Quote from impactful comment]" - [Brief context about why this comment is valuable]

**Success Stories:**
- "[Quote from success story]" - [How this validates content direction]

**Pain Point Examples:**
- "[Quote expressing frustration/challenge]" - [What this reveals about audience needs]

## Content Strategy Recommendations
[2-3 sentences on content sequencing, format recommendations, and how these ideas work together to create a comprehensive learning journey for the audience]

## Key Themes and Keywords
**Primary Themes**: [3-5 major topics that dominate the conversation]
**Secondary Themes**: [3-5 supporting topics mentioned frequently]  
**SEO Keywords**: [5-10 specific phrases and terms used by the audience]
**Content Gaps**: [2-3 topics the audience wants but weren't covered in the original video]

---JSON_SEPARATOR---

{
  "audienceOverview": {
    "demographics": "Description of audience composition and characteristics",
    "psychographics": "Goals, motivations, and behavioral patterns",
    "experienceLevel": "Beginner/Intermediate/Advanced or mixed",
    "primaryGoals": ["goal1", "goal2", "goal3"]
  },
  "sentimentAnalysis": {
    "overall": "positive/neutral/negative",
    "positive": X,
    "neutral": Y, 
    "negative": Z,
    "enthusiasmLevel": "high/medium/low",
    "engagementQuality": "high/medium/low",
    "concerns": ["concern1", "concern2"]
  },
  "painPoints": [
    {
      "issue": "Main pain point description",
      "frequency": X,
      "impact": "high/medium/low"
    }
  ],
  "knowledgeGaps": [
    {
      "topic": "Gap description", 
      "mentions": X,
      "urgency": "high/medium/low"
    }
  ],
  "contentIdeas": [
    {
      "id": "comment_idea_1",
      "title": "The Catchy SEO-Friendly Title",
      "format": "Article/Video/Guide format",
      "audienceNeed": "Specific need identified in X comments",
      "priorityLevel": "high/medium/low",
      "keyTopics": [
        "Main point to cover",
        "Secondary point", 
        "Additional point",
        "Final point"
      ],
      "successMetrics": "How to measure content success",
      "estimatedEngagement": "high/medium/low"
    }
  ],
  "topQuestions": [
    {
      "question": "Exact question from comments",
      "mentions": X,
      "commenters": Y,
      "urgency": "high/medium/low"
    }
  ],
  "notableComments": {
    "highValueQuestions": [
      {
        "comment": "Quote from impactful comment",
        "context": "Why this comment is valuable",
        "likes": X
      }
    ],
    "successStories": [
      {
        "comment": "Quote from success story", 
        "validation": "How this validates content direction"
      }
    ],
    "painPointExamples": [
      {
        "comment": "Quote expressing frustration",
        "insight": "What this reveals about audience needs"
      }
    ]
  },
  "contentStrategy": "Strategic recommendation for content sequencing and format",
  "keyThemes": {
    "primary": ["theme1", "theme2", "theme3"],
    "secondary": ["theme4", "theme5", "theme6"], 
    "seoKeywords": ["keyword1", "keyword2", "keyword3"],
    "contentGaps": ["gap1", "gap2", "gap3"]
  }
}

IMPORTANT: Do not include any delimiter markers like ---PLAINTEXT_REPORT_START--- or ---PLAINTEXT_REPORT_END--- in your response. Only use the single ---JSON_SEPARATOR--- to divide the plaintext from JSON sections.

ANALYSIS DEPTH REQUIREMENTS:
- Quote specific comments when they illustrate important points
- Provide concrete numbers (mentions, likes, etc.) whenever possible  
- Identify patterns across multiple comments, not just individual requests
- Consider the relationship between comment sentiment and content opportunities
- Adapt analysis depth based on the volume and quality of available comments
- Focus on actionable insights that directly inform content creation decisions

Focus on addressing real audience needs rather than hypothetical content. Ensure the plaintext report and JSON structure contain the same insights and recommendations with rich, specific details that enable data-driven content decisions.
```

## Key Improvements Made:

### Enhanced Audience Overview Section:
1. **Demographics & Psychographics** - Better understanding of who the audience is
2. **Sentiment Analysis** - Concrete emotional analysis with percentages
3. **Key Pain Points & Challenges** - Specific problems with evidence
4. **Knowledge Gaps & Learning Preferences** - What they want to learn and how
5. **Community Dynamics** - How the audience interacts and engages

### Improved Content Ideas Format:
- **Priority Level** - Helps prioritize which content to create first
- **Success Metrics** - How to measure if the content works
- **Quote Examples** - Specific comment evidence for each need
- **Estimated Engagement** - Predicted content performance

### New Sections Added:
- **Notable Comment Examples** - Actual quotes that illustrate key points
- **Enhanced JSON Structure** - More detailed data for future analysis
- **Analysis Depth Requirements** - Instructions for thorough analysis

### Better Instructions:
- More specific analysis requirements
- Emphasis on quoting actual comments
- Instructions to provide concrete numbers
- Adaptive analysis based on comment volume and quality

