export const circleStyles = [
  { id: 'layers', label: '新案 重なる余白', note: '小さな時間を重ね、日・月・年の束に。', explanation: '薄い1層は1時間です。24時間で1日分に束ね、30日分で月、365日分で年の束に換算します。束と端数を省略せず表示し、365日未満の12か月を1年に丸めません。側面の厚さは読み分けのための表現で、面積や体積が時間に比例する設計ではありません。' },
  { id: 'rings', label: 'A 重なる輪', note: '越えてきた節目を、線の重なりに。', explanation: '輪は累計が1時間・1日・約1か月・約1年分になった節目を、内側から順に表します。輪1本が1日分という意味ではありません。端数は中央の数字で表示します。' },
  { id: 'ticks', label: 'B 粒の輪', note: '小さな時間の積み重ねを、細かな質感に。', explanation: '粒の輪は積み重ねを感じるための固定の模様です。1粒ごとの時間や進捗の割合を表していません。時間の長さは中央の数値で確認します。' },
  { id: 'disc', label: 'C まるい余白', note: '大きな時間を、やわらかな面で包む。', explanation: '円の面は数値を包む背景表現です。面積に時間の量を割り当てず、まとまった時間と端数を中央の数値で確認します。' },
  { id: 'original', label: '比較 元のサークル', note: 'まとまった時間と端数の円弧。', explanation: '中央はまとまった時間、円弧はその端数です。「時間分」の間は、24時間の中に積み重ねた長さを示します。' },
] as const;
export type CircleStyle = (typeof circleStyles)[number]['id'];
export const isCircleStyle = (value: unknown): value is CircleStyle => circleStyles.some(option => option.id === value);
