// Railway Expert Search Service
// This is a completely independent Node.js server for Railway deployment
// Handles persistent expert search polling with Clado API
// EXACT copy of the working /api/clado-search logic from Vercel
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3001;

// Enable CORS and JSON parsing
app.use(cors());
app.use(express.json());

// EXACT SAME Map-based storage for concurrent searches
const searchResults = new Map();           // call-id → clado results
const pollingIntervals = new Map();       // call-id → polling timer  
const queryTexts = new Map();             // call-id → original query
const jobIds = new Map();                 // call-id → clado job id
const userNames = new Map();              // call-id → user first name
const projectIds = new Map();             // call-id → project id

// Global for testing (last completed search)
let latestCladoResults = null;

// Initialize Supabase client (EXACT same as Vercel)
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

// EXACT SAME function to update project tracking columns
async function updateProjectStatus(projectId, status, incrementPolling = false) {
  try {
    const updateData = {};
    
    if (status) {
      updateData.clado_status = status;
    }
    
    if (incrementPolling) {
      // Increment polling count
      const { data: currentProject } = await supabase
        .from('projects')
        .select('clado_polling_count')
        .eq('id', projectId)
        .single();
        
      const currentCount = currentProject?.clado_polling_count || 0;
      updateData.clado_polling_count = currentCount + 1;
    }
    
    if (Object.keys(updateData).length > 0) {
      const { error } = await supabase
        .from('projects')
        .update(updateData)
        .eq('id', projectId);

      if (error) {
        console.error('❌ Error updating project status:', error);
      } else {
        console.log(`✅ Project ${projectId} updated:${status ? ` status=${status}` : ''}${incrementPolling ? ` poll_count=${updateData.clado_polling_count}` : ''}`);
      }
    }
  } catch (error) {
    console.error('❌ Exception updating project status:', error);
  }
}

// EXACT SAME function to save experts to database
async function saveExpertsToDatabase(results, projectId, query) {
  if (!results.results || !Array.isArray(results.results)) {
    console.log('No experts found in results to save');
    return;
  }

  console.log(`💾 Saving ${results.results.length} experts to database for project ${projectId}`);
  console.log(`📊 Experts will be ranked 1-${results.results.length} based on Clado's result order`);

  const expertsToInsert = results.results.map((result, index) => {
    const profile = result.profile;
    
    // Extract reasoning from all criteria
    let reasoning = '';
    if (profile.criteria) {
      const reasoningParts = [];
      for (const criteriaKey in profile.criteria) {
        const criteria = profile.criteria[criteriaKey];
        if (criteria.reasoning) {
          reasoningParts.push(criteria.reasoning);
        }
      }
      reasoning = reasoningParts.join('\n\n');
    }

    // Preserve exact JSON format by converting to string and back to object
    const preservedJson = JSON.parse(JSON.stringify(result));

    return {
      name: profile.name || '',
      project_id: projectId,
      linkedin_url: profile.linkedin_profile_url || profile.linkedin_url || '',
      headline: profile.headline || '',
      summary: profile.summary || '',
      reasoning: reasoning,
      for_query: query,
      rank: index + 1, // 1-indexed rank to preserve Clado's result order
      raw_json: preservedJson // Store the entire result object with preserved JSON structure
    };
  });

  try {
    const { data, error } = await supabase
      .from('experts')
      .insert(expertsToInsert)
      .select();

    if (error) {
      console.error('❌ Error saving experts to database:', error);
    } else {
      console.log(`✅ Successfully saved ${data.length} experts to database with ranks 1-${data.length}`);
      console.log(`🔗 Query: "${query}" | Project: ${projectId}`);
      
      // Update project status to success after experts are saved
      await updateProjectStatus(projectId, 'success');
    }
  } catch (error) {
    console.error('❌ Exception saving experts to database:', error);
  }
}

// EXACT SAME polling function with 1-minute interval (changed from 30 seconds)
function startPolling(searchId, apiKey, callId) {
  // Clear any existing polling for THIS specific call (in case of restart)
  const existingInterval = pollingIntervals.get(callId);
  if (existingInterval) {
    clearInterval(existingInterval);
    pollingIntervals.delete(callId);
  }

  console.log(`Starting polling for search ID: ${searchId} [Call ID: ${callId}]`);
  let checkNumber = 0;

  const pollingInterval = setInterval(async () => {
    try {
      checkNumber++;
      console.log(`Polling status check ${checkNumber} (every 60 sec) for search ID: ${searchId} [Call ID: ${callId}]`);

      const statusResponse = await fetch(`https://search.clado.ai/api/search/deep_research/${searchId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (!statusResponse.ok) {
        console.error(`Status check failed for ${searchId} [Call ID: ${callId}]:`, await statusResponse.text());
        return;
      }

      const statusData = await statusResponse.json();
      console.log(`Status for ${searchId} [Call ID: ${callId}]:`, statusData.status);

      // Increment polling count and update status only after successful Clado API call
      const currentProjectId = projectIds.get(callId);
      if (currentProjectId) {
        // Always increment polling count after successful status check
        await updateProjectStatus(currentProjectId, undefined, true);
        
        // Update status based on Clado response
        if (statusData.status && (statusData.status === 'searching' || statusData.status === 'filtering')) {
          await updateProjectStatus(currentProjectId, statusData.status);
        }
      }

      // Check if search is successful
      if (statusData.status === 'completed' || statusData.status === 'success') {
        console.log(`Search ${searchId} completed successfully! [Call ID: ${callId}]`);
        
        // Store the results for this specific call with all context data
        const queryText = queryTexts.get(callId);
        const userName = userNames.get(callId);
        const projectId = projectIds.get(callId);
        
        console.log(`🔍 DEBUG - Building results for ${callId}:`);
        console.log(`  - queryText: ${queryText}`);
        console.log(`  - userName: ${userName}`);
        console.log(`  - projectId: ${projectId}`);
        
        const resultsWithContext = {
          query: queryText,
          user_name: userName,
          project_id: projectId,
          call_id: callId,
          ...statusData
        };
        
        searchResults.set(callId, resultsWithContext);
        latestCladoResults = resultsWithContext;
        
        // Stop polling for this specific call
        const intervalToStop = pollingIntervals.get(callId);
        if (intervalToStop) {
          clearInterval(intervalToStop);
          pollingIntervals.delete(callId);
        }
        
        console.log(`Polling stopped for Call ID: ${callId}. Results stored.`);
        
        // Save experts to database
        if (projectId && queryText) {
          await saveExpertsToDatabase(statusData, projectId, queryText);
        } else {
          console.log('⚠️ Missing projectId or queryText, skipping database save');
        }
        
      } else if (statusData.status === 'failed' || statusData.status === 'error') {
        console.error(`Search ${searchId} failed [Call ID: ${callId}]:`, statusData);
        
        // Update project status to failed
        const currentProjectId = projectIds.get(callId);
        if (currentProjectId) {
          await updateProjectStatus(currentProjectId, 'failed');
        }
        
        // Stop polling on failure
        const intervalToStop = pollingIntervals.get(callId);
        if (intervalToStop) {
          clearInterval(intervalToStop);
          pollingIntervals.delete(callId);
        }
        
        // Clean up data for failed search
        searchResults.delete(callId);
        queryTexts.delete(callId);
        jobIds.delete(callId);
        userNames.delete(callId);
        projectIds.delete(callId);
      }
      // Continue polling for other statuses like 'processing', 'pending', etc.

    } catch (error) {
      console.error(`Error polling status for ${searchId} [Call ID: ${callId}]:`, error);
    }
  }, 30000); // Poll every 30 seconds
  
  // Store the polling interval for this specific call
  pollingIntervals.set(callId, pollingInterval);
}

// Main expert search endpoint - EXACT same logic as Vercel
app.post('/expert-search', async (req, res) => {
  try {
    // Get unique call identifier for this search
    const callId = req.headers['x-call-id'] || `direct-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
    
    let search_query = req.body.search_query;
    let userFirstName = req.body.user_first_name || null;
    let projectId = req.body.project_id || null;

    console.log(`Expert search request received with query: ${search_query} [Call ID: ${callId}] [Project ID: ${projectId}]`);

    if (!search_query) {
      return res.status(400).json({
        error: 'search_query is required'
      });
    }

    // Get Clado API key from environment
    const cladoApiKey = process.env.CLADO_API_KEY;
    if (!cladoApiKey) {
      return res.status(500).json({
        error: 'Clado API key not configured'
      });
    }

    console.log(`Initiating Clado search for query: ${search_query}`);

    // EXACT SAME Clado initiation
    const initiateResponse = await fetch('https://search.clado.ai/api/search/deep_research', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${cladoApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: search_query,
        limit: 30
      }),
    });

    if (!initiateResponse.ok) {
      const errorText = await initiateResponse.text();
      console.error('Clado initiate search failed:', errorText);
      
      // Update project status to failed if we have projectId
      if (projectId) {
        await updateProjectStatus(projectId, 'failed');
      }
      
      return res.status(initiateResponse.status).json({
        error: 'Failed to initiate Clado search',
        details: errorText
      });
    }

    const initiateData = await initiateResponse.json();
    const searchId = initiateData.job_id;

    if (!searchId) {
      if (projectId) {
        await updateProjectStatus(projectId, 'failed');
      }
      return res.status(500).json({
        error: 'No search ID returned from Clado'
      });
    }

    console.log(`Clado search initiated with ID: ${searchId} [Call ID: ${callId}]`);

    // Store search data in Maps for this specific call (EXACT same)
    queryTexts.set(callId, search_query);
    jobIds.set(callId, searchId);
    if (userFirstName) userNames.set(callId, userFirstName);
    if (projectId) {
      projectIds.set(callId, projectId);
      // Set initial status to "searching" when Clado request is initiated
      await updateProjectStatus(projectId, 'searching');
    }

    // Start background polling for this specific call
    startPolling(searchId, cladoApiKey, callId);

    // Return success immediately
    res.json({
      success: true,
      message: 'Search initiated successfully',
      search_id: searchId,
      call_id: callId
    });

  } catch (error) {
    console.error('Expert search endpoint error:', error);
    res.status(500).json({
      error: 'Internal server error',
      details: error.message
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    activePolling: pollingIntervals.size 
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Railway Expert Search Service running on port ${PORT}`);
  console.log(`📊 Ready to handle expert search requests`);
});