export const starterWords = [
 ['serendipity','noun','Finding something good or valuable when you weren’t looking for it.','Meeting my future business partner on a delayed train was pure serendipity.','/ˌser.ənˈdɪp.ə.ti/'],
 ['articulate','adjective','Able to express ideas clearly and effectively.','The articulate speaker made a complicated idea easy to understand.','/ɑːrˈtɪk.jə.lət/'],
 ['resilient','adjective','Able to recover or adapt after difficulty.','Despite the setbacks, she remained resilient and tried again.','/rɪˈzɪl.i.ənt/'],
 ['nuance','noun','A small but meaningful difference in meaning, expression, or feeling.','The translator captured every nuance of the original poem.','/ˈnuː.ɑːns/'],
 ['eloquent','adjective','Expressing thoughts in a clear, powerful, and moving way.','His eloquent speech inspired the team to keep going.','/ˈel.ə.kwənt/'],
 ['ephemeral','adjective','Lasting for only a short time.','The beauty of a sunset is ephemeral.','/ɪˈfem.ər.əl/'],
 ['pragmatic','adjective','Focused on practical solutions and what works.','We took a pragmatic approach and fixed the biggest problem first.','/præɡˈmæt.ɪk/'],
 ['curiosity','noun','A strong desire to know or learn something.','Her curiosity led her to explore how the machine worked.','/ˌkjʊr.iˈɑː.sə.ti/']
].map(([word,part,definition,example,phonetic],i)=>({id:`starter-${i}`,word,part,definition,example,phonetic,source:'starter',due:Date.now(),added:Date.now(),interval:0,reviews:0,lapses:0}));
