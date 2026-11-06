import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8').replace(/^export \{[^\n]*\};?$/gm, '').replace(/^export /gm, '');
const track = {id:'test-video',name:'Test Song',artists:[{name:'Test Singer'}],album:{name:'Test Album'},duration:240000};
const next = {tabs:[{browseEndpoint:{browseId:'MPLY_test'}}]};
const timed = {timedLyricsData:[
  {lyricLine:'Synthetic first line',cueRange:{startTimeMilliseconds:'1000',endTimeMilliseconds:'2000'}},
  {lyricLine:'Synthetic second line',cueRange:{startTimeMilliseconds:'2000',endTimeMilliseconds:'3000'}},
]};
const record = {trackName:'Test Song',artistName:'Test Singer',albumName:'Test Album',duration:240,instrumental:false,syncedLyrics:'[00:01.00]Synthetic first line\n[00:02.00]Synthetic second line'};
const reply = (data,status=200,headers={}) => ({ok:status>=200&&status<300,status,headers:{get:k=>headers[k]??null},json:async()=>data});

function runtime(route, {timerScale=1}={}) {
  const calls=[];
  const storage=new Map();
  let cookieReads=0;
  const context=vm.createContext({
    URL,URLSearchParams,TextEncoder,AbortController,
    setTimeout:(f,ms)=>setTimeout(f,Math.max(1,ms*timerScale)),clearTimeout,
    console:{warn(){},log(){}},
    host:{platform:'darwin',arch:'arm64',setting(){return '';},storage:{
      get(k){if(k==='cookie'){cookieReads++;throw Error('Lyrics must never read session credentials');}return storage.get(k);},
      set(k,v){storage.set(k,JSON.parse(JSON.stringify(v)));},remove(k){storage.delete(k);},
    }},
    fetch:async(url,options={})=>{
      const u=new URL(url);
      assert.ok(['music.youtube.com','lrclib.net','api.betterlyrics.org'].includes(u.hostname));
      const headers=options.headers||{};
      assert.equal(headers.cookie,undefined);
      assert.equal(headers.authorization,undefined);
      calls.push({url:String(url),options});
      return route(u,options,calls);
    },
  });
  const api=vm.runInContext(source+'\n;({lyrics, rememberLyricTrack, lyricJSON, matchingLyricRecord, cleanLyricTitle});',context);
  api.rememberLyricTrack(JSON.parse(JSON.stringify(track)));
  return {api,calls,storage,cookieReads:()=>cookieReads};
}

const tests=[];
function test(name,fn){tests.push({name,fn});}

test('YouTube lyrics work without touching cookies and successful results are cached',async()=>{
  const r=runtime(u=>reply(u.pathname.endsWith('/next')?next:timed));
  const [one,two]=await Promise.all([r.api.lyrics({id:track.id}),r.api.lyrics({id:track.id})]);
  assert.equal(one.lines.length,2);assert.equal(two.lines.length,2);assert.equal(r.calls.length,2);
  const cached=await r.api.lyrics({id:track.id});assert.equal(cached.lines.length,2);assert.equal(r.calls.length,2);
  assert.equal(r.cookieReads(),0);
});

test('LRCLIB survives a failed YouTube request using catalog metadata',async()=>{
  const r=runtime(u=>u.hostname==='lrclib.net'?reply(record):reply({},503));
  const result=await r.api.lyrics({id:track.id});assert.equal(result.lrc,record.syncedLyrics);
  assert.ok(r.storage.get('lyricsFixDiagnosticsV1')[0].result==='lrclib');
});

test('LRCLIB search rejects a wrong artist and a wrong recording duration',async()=>{
  const r=runtime(u=>{
    if(u.pathname.endsWith('/next'))return reply(next);
    if(u.pathname.endsWith('/browse'))return reply({});
    if(u.pathname==='/api/get')return reply({},404);
    return reply([{...record,artistName:'Wrong Singer'},{...record,duration:301},record]);
  });
  assert.equal((await r.api.lyrics({id:track.id})).lrc,record.syncedLyrics);
});

test('Missing lyrics are retried; Better Lyrics 401 is cooled down',async()=>{
  let available=false;
  const r=runtime(u=>{
    if(u.pathname.endsWith('/next'))return reply(next);
    if(u.pathname.endsWith('/browse'))return reply(available?timed:{});
    if(u.hostname==='api.betterlyrics.org')return reply({},401);
    return u.pathname==='/api/get'?reply({},404):reply([]);
  });
  const first=await r.api.lyrics({id:track.id});assert.match(first.lines[0].text,/暂未获取/);
  assert.equal(r.storage.has('lyricsFixCacheV1'),false);
  await r.api.lyrics({id:track.id});
  assert.equal(r.calls.filter(c=>c.url.includes('betterlyrics.org')).length,1);
  available=true;assert.equal((await r.api.lyrics({id:track.id})).lines.length,2);
});

test('Rate limiting honors Retry-After across successive tracks',async()=>{
  const r=runtime(u=>{
    if(u.pathname.endsWith('/next'))return reply({});
    if(u.hostname==='lrclib.net')return reply({},429,{'retry-after':'120'});
    return reply({},401);
  });
  await r.api.lyrics({id:track.id});await r.api.lyrics({id:track.id});
  assert.equal(r.calls.filter(c=>c.url.includes('lrclib.net')).length,1);
});

test('Only a matching exact record can classify a track as instrumental',async()=>{
  const r=runtime(u=>u.pathname.endsWith('/next')?reply({}):reply({...record,instrumental:true,syncedLyrics:null}));
  assert.equal((await r.api.lyrics({id:track.id})).lines.length,0);
  const wrong=runtime(u=>{
    if(u.pathname.endsWith('/next'))return reply({});
    if(u.hostname==='api.betterlyrics.org')return reply({},401);
    if(u.pathname==='/api/search')return reply([{...record,instrumental:true,syncedLyrics:null}]);
    return reply({},404);
  });
  assert.match((await wrong.api.lyrics({id:track.id})).lines[0].text,/暂未获取/);
});

test('Metadata normalization keeps live recordings distinct',()=>{
  const r=runtime(()=>reply({}));
  assert.equal(r.api.cleanLyricTitle('Test Song (Official Audio)'),'Test Song');
  assert.equal(r.api.matchingLyricRecord({...record,trackName:'Test Song (Live)'},track),false);
});

test('Hung lyric requests have a bounded timeout',async()=>{
  const r=runtime(()=>new Promise(()=>{}),{timerScale:0.001});
  const at=Date.now();
  await assert.rejects(r.api.lyricJSON('https://music.youtube.com/test',{},Date.now()+2000,1000),/timeout/);
  assert.ok(Date.now()-at<1000);
});

let passed=0;
for(const {name,fn} of tests){await fn();passed++;console.log('PASS',name);}
console.log(`${passed} meaningful checks passed.`);
