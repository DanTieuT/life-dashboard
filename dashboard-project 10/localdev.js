// Simple local dev server — run with: node localdev.js
const http = require('http');
const fs   = require('fs');
const path = require('path');

// Load .env file
try {
  fs.readFileSync('.env','utf8').split('\n').forEach(line=>{
    const eq = line.indexOf('=');
    if(eq>0){
      const k=line.slice(0,eq).trim();
      const v=line.slice(eq+1).trim();
      if(k)process.env[k]=v;
    }
  });
} catch(e){}

const PORT = 8888;
const MIME = {
  '.html':'text/html','.js':'application/javascript',
  '.css':'text/css','.json':'application/json',
  '.png':'image/png','.ico':'image/x-icon','.svg':'image/svg+xml'
};

const server = http.createServer(async (req,res)=>{
  // Telegram webhook endpoint
  if(req.url.startsWith('/.netlify/functions/telegram')){
    if(req.method==='OPTIONS'){
      res.writeHead(200,{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'POST,OPTIONS'});
      res.end();return;
    }
    let body='';
    req.on('data',c=>body+=c);
    req.on('end',async()=>{
      try{
        delete require.cache[require.resolve('./netlify/functions/telegram.js')];
        const handler=require('./netlify/functions/telegram.js');
        const result=await handler.handler({httpMethod:'POST',headers:req.headers,body});
        res.writeHead(result.statusCode,result.headers||{});
        res.end(result.body);
      }catch(e){
        res.writeHead(200,{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
        res.end(JSON.stringify({error:'Function error: '+e.message}));
      }
    });
    return;
  }

  // Speak function endpoint (OpenAI TTS)
  if(req.url.startsWith('/.netlify/functions/speak')){
    if(req.method==='OPTIONS'){
      res.writeHead(200,{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'POST,OPTIONS'});
      res.end();return;
    }
    let body='';
    req.on('data',c=>body+=c);
    req.on('end',async()=>{
      try{
        delete require.cache[require.resolve('./netlify/functions/speak.js')];
        const handler=require('./netlify/functions/speak.js');
        const result=await handler.handler({httpMethod:'POST',headers:req.headers,body});
        res.writeHead(result.statusCode,result.headers||{});
        res.end(result.body);
      }catch(e){
        res.writeHead(200,{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
        res.end(JSON.stringify({error:'Function error: '+e.message}));
      }
    });
    return;
  }

  // Transcribe function endpoint (Whisper)
  if(req.url.startsWith('/.netlify/functions/transcribe')){
    if(req.method==='OPTIONS'){
      res.writeHead(200,{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'POST,OPTIONS'});
      res.end();return;
    }
    let body='';
    req.on('data',c=>body+=c);
    req.on('end',async()=>{
      try{
        delete require.cache[require.resolve('./netlify/functions/transcribe.js')];
        const handler=require('./netlify/functions/transcribe.js');
        const result=await handler.handler({httpMethod:'POST',headers:req.headers,body});
        res.writeHead(result.statusCode,result.headers||{});
        res.end(result.body);
      }catch(e){
        res.writeHead(200,{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
        res.end(JSON.stringify({error:'Function error: '+e.message}));
      }
    });
    return;
  }

  // Chat function endpoint
  if(req.url.startsWith('/.netlify/functions/chat')){
    if(req.method==='OPTIONS'){
      res.writeHead(200,{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'POST,OPTIONS'});
      res.end();return;
    }
    let body='';
    req.on('data',c=>body+=c);
    req.on('end',async()=>{
      try{
        // Delete require cache so edits to chat.js are picked up on refresh
        delete require.cache[require.resolve('./netlify/functions/chat.js')];
        const handler=require('./netlify/functions/chat.js');
        const result=await handler.handler({httpMethod:'POST',headers:req.headers,body});
        res.writeHead(result.statusCode,result.headers||{});
        res.end(result.body);
      }catch(e){
        res.writeHead(200,{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
        res.end(JSON.stringify({reply:'Function error: '+e.message,actions:[]}));
      }
    });
    return;
  }

  // Morning briefing (manual test trigger)
  if(req.url.startsWith('/.netlify/functions/morning-briefing')){
    try{
      const qs=Object.fromEntries(new URL(req.url,'http://localhost').searchParams);
      delete require.cache[require.resolve('./netlify/functions/morning-briefing.js')];
      const handler=require('./netlify/functions/morning-briefing.js');
      const result=await handler.handler({queryStringParameters:qs});
      res.writeHead(result.statusCode,{'Content-Type':'text/plain'});
      res.end(result.body);
    }catch(e){
      res.writeHead(500,{'Content-Type':'text/plain'});
      res.end('Error: '+e.message);
    }
    return;
  }

  // Event reminder (manual test trigger)
  if(req.url.startsWith('/.netlify/functions/event-reminder')){
    try{
      const qs=Object.fromEntries(new URL(req.url,'http://localhost').searchParams);
      delete require.cache[require.resolve('./netlify/functions/event-reminder.js')];
      const handler=require('./netlify/functions/event-reminder.js');
      const result=await handler.handler({queryStringParameters:qs});
      res.writeHead(result.statusCode,{'Content-Type':'text/plain'});
      res.end(result.body);
    }catch(e){
      res.writeHead(500,{'Content-Type':'text/plain'});
      res.end('Error: '+e.message);
    }
    return;
  }

  // Static files — resolve + confirm the path stays inside the project root
  // (blocks ../ traversal) and refuse dotfiles (.env, .git/…) and anything
  // under netlify/functions/ (service-account.json, function source with
  // require()'d secrets). This server has no auth and used to bind on all
  // interfaces, so anyone on the same network as `node localdev.js` could
  // otherwise just GET /.env or /netlify/functions/service-account.json.
  const root=path.resolve('.');
  let urlPath=req.url.split('?')[0];
  if(urlPath==='/') urlPath='/index.html';
  const filePath=path.resolve(root,'.'+urlPath);
  const rel=path.relative(root,filePath);
  const blocked=rel.startsWith('..')||path.isAbsolute(rel)
    ||rel.split(path.sep).some(seg=>seg.startsWith('.'))
    ||rel.startsWith('netlify'+path.sep+'functions'+path.sep)||rel==='package-lock.json';
  if(blocked){
    res.writeHead(403,{'Content-Type':'text/plain'});
    res.end('Forbidden');
    return;
  }
  const ext=path.extname(filePath);
  fs.readFile(filePath,(err,content)=>{
    if(err){
      fs.readFile('./index.html',(e2,c2)=>{
        res.writeHead(200,{'Content-Type':'text/html'});
        res.end(c2);
      });
    } else {
      res.writeHead(200,{'Content-Type':MIME[ext]||'text/plain'});
      res.end(content);
    }
  });
});

server.listen(PORT,'127.0.0.1',()=>{
  const anthropicKey=process.env.ANTHROPIC_API_KEY;
  const openaiKey=process.env.OPENAI_API_KEY;
  console.log('\n✓ Dev server running at http://localhost:'+PORT);
  console.log('  Anthropic key: '+(anthropicKey?'✓ loaded ('+anthropicKey.slice(0,12)+'...)':'✗ NOT FOUND — add ANTHROPIC_API_KEY to .env'));
  console.log('  OpenAI key:    '+(openaiKey?'✓ loaded ('+openaiKey.slice(0,12)+'...)':'✗ NOT FOUND — add OPENAI_API_KEY to .env for Whisper STT'));
  console.log('\nPress Ctrl+C to stop.\n');
});
