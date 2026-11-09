-- Devolve o vídeo ao post da Mayara (Tiago 3, leitura de 07/11/2026).
-- Decisão de 09/11/2026: o post fica sem esse vídeo. Este script fica só como registro, caso mudem de ideia.
--
-- Em 09/11/2026 o vídeo foi tirado do post só no banco, para parar de gastar a cota: sem capa, ele era
-- baixado inteiro (27 MB) toda vez que alguém abria o app (3,7 GB num dia). O arquivo continua guardado
-- no armazenamento; nada foi apagado. Rode este script depois que a versão do app com
-- "vídeo só baixa no play" estiver no ar.
update public.checkins
   set photo_path = '9b3d254b-47e3-42cf-8494-ea72859e5052/99ef405a9b4598490f1fc46fa2c11d06e3878c10.mov',
       media_type = 'video',
       media_source = 'galeria'
 where id = 'e15ee801-63bc-41be-9dfa-75c79ae322dc'
   and photo_path is null;
