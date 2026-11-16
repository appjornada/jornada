-- Registro (16/11/2026): 3 fotos enviadas em 06/11, antes da compressão do app, com 2,5 MB, 3,4 MB e 3,7 MB
-- e sem miniatura. O mural baixava cada uma inteira para cada pessoa (~20 MB por dia). A dona não abre o app
-- desde 06/11, então o app dela nunca as deixou leves. A pedido do Roger, as 3 fotos foram APAGADAS do
-- armazenamento e tiradas da publicação (Tiago 1–2, leitura de 06/11). A publicação continua, com o texto e os passos.
-- Os arquivos não podem ser recuperados. Este é só o registro de como a publicação estava:
--
-- checkins.id = '2873c4b0-11f9-4243-b05c-33f1bb7fbb54'
-- photo_path antes = 'ea41a549-732c-4ba4-ae37-e151b13edae9/1793970284597-se6t10.jpg|ea41a549-732c-4ba4-ae37-e151b13edae9/1793970285990-hdew2u.jpg|ea41a549-732c-4ba4-ae37-e151b13edae9/1793970288247-e7weiw.jpg'
update public.checkins set photo_path = null
 where id = '2873c4b0-11f9-4243-b05c-33f1bb7fbb54'
   and photo_path = 'ea41a549-732c-4ba4-ae37-e151b13edae9/1793970284597-se6t10.jpg|ea41a549-732c-4ba4-ae37-e151b13edae9/1793970285990-hdew2u.jpg|ea41a549-732c-4ba4-ae37-e151b13edae9/1793970288247-e7weiw.jpg';
