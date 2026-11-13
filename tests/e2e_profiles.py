from _common import *   # ROOT, server, stop, check, shot, run, GQL


def newpage(b, errs, state=None, locale='fr-FR'):
    ctx=b.new_context(viewport={'width':390,'height':844}, device_scale_factor=2, is_mobile=True, has_touch=True, locale=locale, color_scheme='dark', storage_state=state)
    pg=ctx.new_page(); pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: errs.append('console: '+m.text) if m.type=='error' and 'Failed to load resource' not in m.text else None)
    return ctx,pg
def read_to_end(pg):
    pg.wait_for_selector('.pg.ok', timeout=8000); pg.wait_for_timeout(400)
    pg.evaluate('scrollTo(0, document.documentElement.scrollHeight)'); pg.wait_for_selector('.end-next > *'); pg.wait_for_timeout(600)


def scenario(b):
    # ── Suwayomi seul ──
    errs=[]; srv=server(8411, SERVERS='suwayomi'); B='http://localhost:8411'
    ctx,pg=newpage(b,errs)
    pg.goto(B+'/'); pg.wait_for_selector('.hero'); pg.wait_for_timeout(600)
    main_hero=pg.inner_text('.hero-sub'); check('main profile resumes from server history', 'Chapitre 10' in main_hero, main_hero)
    check('no avatar while a single profile exists', pg.locator('.avatar').count()==0)
    pg.goto(B+'/#/profiles'); pg.wait_for_selector('.who'); pg.wait_for_timeout(300)
    check('French interface: main profile is shown as Principal', pg.inner_text('.profile-main strong')=='Principal', pg.inner_text('.profile-main strong'))
    # même serveur, interface en anglais : le profil principal s'affiche « Main » alors que la liste enregistrée garde « Principal »
    ectx,epg=newpage(b,errs,locale='en-US')
    epg.goto(B+'/#/profiles'); epg.wait_for_selector('.who .profile-main'); epg.wait_for_timeout(300)
    check('English interface: main profile is shown as Main', epg.inner_text('.profile-main strong')=='Main', epg.inner_text('.profile-main strong'))
    check('English interface: avatar initial follows the shown name', epg.inner_text('.profile-main .avatar')=='M', epg.inner_text('.profile-main .avatar'))
    stored=epg.evaluate("JSON.parse(localStorage.getItem('scrollarr.profiles.cache')||'[]').map(p=>p.name)")
    check('English interface: stored name of the main profile is unchanged', stored in ([], ['Principal']), stored); ectx.close()
    pg.goto(B+'/#/more'); pg.wait_for_selector('.panel'); pg.click('text=Gérer les profils'); pg.wait_for_selector('.who'); pg.wait_for_timeout(300)
    shot(pg,'60-profiles-one.png')
    pg.click('text=Ajouter un profil'); pg.wait_for_selector('.sheet input'); pg.fill('.sheet input','Léa'); pg.click('.sheet button[type=submit]'); pg.wait_for_selector('.profile >> nth=1'); pg.wait_for_timeout(400)
    shot(pg,'61-profiles-two.png')
    pg.click('.profile-main >> text=Léa'); pg.wait_for_selector('.hero', timeout=8000); pg.wait_for_timeout(900)
    shot(pg,'62-profile-home.png')
    check('extra profile: empty history on home', 'Reprendre' not in pg.eval_on_selector_all('.row-head h2','e=>e.map(x=>x.textContent)') and pg.inner_text('.hero-kicker')=='Dernière arrivée', pg.inner_text('.hero-kicker'))
    check('avatar shows active profile', pg.inner_text('.avatar.small')=='L')
    pg.goto(B+'/#/library'); pg.wait_for_selector('.grid .card'); pg.select_option('.filters select >> nth=1','IN_PROGRESS'); pg.wait_for_timeout(700)
    check('extra profile: nothing in progress', pg.locator('.grid .card').count()==0, pg.locator('.grid .card').count())
    pg.select_option('.filters select >> nth=1',''); pg.wait_for_timeout(300)
    pg.goto(B+'/#/series/s:3'); pg.wait_for_selector('.eps .ep'); pg.wait_for_timeout(300)
    check('extra profile: series starts from scratch', 'Commencer au chapitre 1' in pg.inner_text('.cta .btn') and pg.locator('.ep.read').count()==0, pg.inner_text('.cta .btn'))
    # lecture dans le profil : rien ne doit changer côté serveur
    pg.goto(B+'/#/series/s:7'); pg.wait_for_selector('.eps .ep'); pg.click('.cta .btn'); read_to_end(pg)
    pg.click('.nextcard'); pg.wait_for_selector('.pg.ok'); pg.wait_for_timeout(400); pg.mouse.wheel(0,2600); pg.wait_for_timeout(6500)
    chs=pg.evaluate(GQL,['Chapters',{'mangaId':7}])['data']['chapters']['nodes']
    check('server history untouched by the profile', not any(c['isRead'] or c['lastPageRead']>0 for c in chs))
    metas=pg.evaluate(GQL,['Metas',{'prefix':'scrollarr.p.'}])['data']['metas']['nodes']; print('  docs on server:', [m['key'] for m in metas])
    check('profile documents stored on Suwayomi', any(k['key'].endswith('.idx') for k in metas) and any('.s.7' in k['key'] for k in metas))
    # autre appareil : pas de copie locale
    st=ctx.storage_state(); ctx.close()
    ctx,pg=newpage(b,errs); pg.goto(B+'/'); pg.wait_for_selector('.who', timeout=8000); pg.wait_for_timeout(300)
    check('new device with several profiles asks who is reading', pg.inner_text('.who-head h1')=='Qui lit ?' and pg.locator('.who-head .iconbtn').count()==0)
    shot(pg,'63-who.png')
    pg.click('.profile-main >> text=Léa'); pg.wait_for_selector('.hero', timeout=8000); pg.wait_for_timeout(900)
    sub=pg.inner_text('.hero-sub'); check('profile history follows to another device', 'Neuf Vies' in pg.inner_text('.hero h2').replace('\n',' ') and 'Chapitre 2' in sub, sub)
    shot(pg,'64-profile-home-after.png')
    pg.goto(B+'/#/series/s:7'); pg.wait_for_selector('.eps .ep'); pg.wait_for_timeout(300)
    check('profile: chapter 1 read, resume chapter 2', pg.locator('.ep.read').count()==1 and 'Reprendre le chapitre 2' in pg.inner_text('.cta .btn'), pg.inner_text('.cta .btn'))
    pg.goto(B+'/#/my/recent'); pg.wait_for_selector('.lines .line'); check('profile: history lists each chapter read', pg.eval_on_selector_all('.line-sub','e=>e.map(x=>x.textContent)')==['Chapitre 2, page 3 sur 10','Chapitre 1 terminé'], pg.eval_on_selector_all('.line-sub','e=>e.map(x=>x.textContent)'))
    pg.goto(B+'/#/library'); pg.wait_for_selector('.grid .card'); pg.select_option('.filters select >> nth=1','IN_PROGRESS'); pg.wait_for_timeout(700)
    check('profile: in-progress filter uses profile history', pg.eval_on_selector_all('.grid .card-title','e=>e.map(x=>x.textContent)')==['Neuf Vies'])
    pg.select_option('.filters select >> nth=1',''); pg.wait_for_timeout(300)
    # tout marquer lu dans le profil (57 chapitres) puis abonnement
    pg.goto(B+'/#/series/s:6'); pg.wait_for_selector('.eps .ep'); pg.click('.shero-bar .iconbtn >> nth=1'); pg.click('.action >> nth=0'); pg.wait_for_timeout(1500)
    check('profile: mark whole series read', pg.locator('.ep.read').count()==57, pg.locator('.ep.read').count())
    c6=pg.evaluate(GQL,['Chapters',{'mangaId':6}])['data']['chapters']['nodes']; check('server: series 6 still 30 read', sum(c['isRead'] for c in c6)==30, sum(c['isRead'] for c in c6))
    pg.click('.sactions .btn >> nth=0'); pg.wait_for_timeout(1300)
    keys=[m['key'] for m in pg.evaluate(GQL,['Metas',{'prefix':'scrollarr.'}])['data']['metas']['nodes']]; check('profile subscriptions stored apart', any(k.endswith('.fav') for k in keys) and 'scrollarr.favorites' not in keys, keys)
    check('marked series document stored', any(k.endswith('.s.6') for k in keys))
    # documents longs : découpage sous la limite de 4096 caractères de Suwayomi
    big=pg.evaluate("""async () => { const api = await import('/js/api.js'); const text = JSON.stringify(Array.from({length: 900}, (_, i) => 'série ' + i)); await api.saveDoc('suwayomi', 'scrollarr.test.big', text); const back = (await api.loadDocs('scrollarr.test.')).suwayomi['scrollarr.test.big']; return [text.length, back === text]; }""")
    check('long document survives chunking', big[1], f'{big[0]} chars')
    # retour au profil principal
    pg.goto(B+'/#/profiles'); pg.wait_for_selector('.who'); pg.wait_for_timeout(300); shot(pg,'65-profiles-active.png')
    pg.click('.profile-main >> text=Principal'); pg.wait_for_selector('.hero', timeout=8000); pg.wait_for_timeout(900)
    check('main profile back to server history', 'Chapitre 10' in pg.inner_text('.hero-sub'), pg.inner_text('.hero-sub'))
    pg.goto(B+'/#/series/s:6'); pg.wait_for_selector('.eps .ep'); pg.wait_for_timeout(300)
    check('main: series 6 shows 30 read, not subscribed', pg.locator('.ep.read').count()==30 and pg.inner_text('.sactions .btn >> nth=0').strip()=='S’abonner', pg.inner_text('.sactions .btn >> nth=0'))
    # cas réel : série prise en cours de route (dernier chapitre lu, début jamais marqué), puis chapitre 1 simplement ouvert
    c5=pg.evaluate(GQL,['Chapters',{'mangaId':5}])['data']['chapters']['nodes']
    pg.evaluate(GQL,['Progress',{'id':c5[-1]['id'],'isRead':True,'lastPageRead':5}]); pg.wait_for_timeout(1100)
    pg.evaluate(GQL,['Progress',{'id':c5[0]['id'],'isRead':False,'lastPageRead':0}])
    pg.goto(B+'/#/my/recent'); pg.reload(); pg.wait_for_selector('.lines .line'); pg.wait_for_timeout(11000); pg.reload(); pg.wait_for_selector('.lines .line')
    first=pg.inner_text('.line >> nth=0').replace('\n',' | '); check('history keeps the chapter actually read', 'La Fille du Phare' in first and 'Chapitre 14 terminé' in first, first)
    pg.goto(B+'/#/series/s:5'); pg.wait_for_selector('.eps .ep'); pg.wait_for_timeout(300)
    check('caught-up series does not send back to chapter 1', 'À jour' in pg.inner_text('.cta .btn') and '14' in pg.inner_text('.cta .btn'), pg.inner_text('.cta .btn'))
    pg.click('.eps .ep-link >> nth=0'); pg.wait_for_selector('.pg.ok'); pg.wait_for_timeout(2500); pg.click('.rbar.top button[aria-label="Retour à la série"]'); pg.wait_for_selector('.eps .ep'); pg.wait_for_timeout(600)
    c1=pg.evaluate(GQL,['Chapter',{'id':c5[0]['id']}])['data']['chapter']; check('opening a chapter without scrolling saves nothing', c1['lastPageRead']==0 and not c1['isRead'] and 'À jour' in pg.inner_text('.cta .btn'))
    # série dont on a lu les chapitres 1 à 12 : la suite proposée est le 13
    pg.goto(B+'/#/home'); pg.wait_for_selector('.hero'); pg.wait_for_timeout(800)
    deck=pg.eval_on_selector_all('.resume','e=>e.map(x=>x.querySelector(".resume-series").textContent+" / "+x.querySelector(".resume-chapter").textContent)'); print('  reprendre:', deck)
    check('on deck proposes the chapter after the last one read', 'Minuit à Kabukichō / Chapitre 13' in deck and not any('Fille du Phare' in d for d in deck))
    # suppression du profil
    pg.goto(B+'/#/profiles'); pg.wait_for_selector('.who'); pg.locator('.profile').nth(1).locator('.iconbtn').click(); pg.click('.action.danger'); pg.wait_for_timeout(1200)
    left=[m['key'] for m in pg.evaluate(GQL,['Metas',{'prefix':'scrollarr.p.'}])['data']['metas']['nodes']]
    check('deleting a profile removes its documents', pg.locator('.profile').count()==1 and left==[], left)
    check('suwayomi: no page errors', not errs, errs); ctx.close(); stop(srv)

    # ── Komga seul : clés conformes aux règles de Komga ──
    errs=[]; srv=server(8412, SERVERS='komga'); B='http://localhost:8412'
    ctx,pg=newpage(b,errs)
    pg.goto(B+'/'); pg.wait_for_selector('.login-form'); pg.fill('input[name=username]','demo@scrollarr.local'); pg.fill('input[name=password]','demo'); pg.click('button[type=submit]'); pg.wait_for_selector('.hero', timeout=8000)
    pg.goto(B+'/#/profiles'); pg.wait_for_selector('.who'); pg.click('text=Ajouter un profil'); pg.fill('.sheet input','Invité'); pg.click('.sheet button[type=submit]'); pg.wait_for_selector('.profile >> nth=1'); pg.wait_for_timeout(300)
    pg.click('.profile-main >> text=Invité'); pg.wait_for_selector('.hero', timeout=8000); pg.wait_for_timeout(600)
    pg.goto(B+'/#/series/k:S005'); pg.wait_for_selector('.eps .ep'); pg.click('.cta .btn'); read_to_end(pg); pg.wait_for_timeout(2600)
    bid=pg.evaluate('location.hash').split(':')[1]
    r=pg.evaluate("async id => (await (await fetch('/komga/api/v1/books/'+id)).json()).readProgress ?? null", bid); check('komga: server progress untouched', r is None, r)
    keys=pg.evaluate("async () => Object.keys(await (await fetch('/komga/api/v1/client-settings/user/list')).json())"); print('  komga keys:', keys)
    check('komga: profile documents accepted', any(k.endswith('.idx') for k in keys) and any('.s.s005' in k for k in keys))
    pg.evaluate("Object.keys(localStorage).filter(k=>k.startsWith('scrollarr.pmirror')).forEach(k=>localStorage.removeItem(k))"); pg.goto(B+'/#/series/k:S005'); pg.reload(); pg.wait_for_selector('.eps .ep'); pg.wait_for_timeout(400)
    check('komga: profile history reloaded from server', pg.locator('.ep.read').count()==1, pg.locator('.ep.read').count())
    check('komga: no page errors', not errs, errs); ctx.close(); stop(srv)


run(scenario)
