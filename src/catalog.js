// Products on the rail. Swap this for your store's product feed.
export const CATALOG = {
  tops: [
    {id:'tee', name:'Everyday tee', price:'Rs 1,450', type:'tee', pattern:'solid',
      colors:[{name:'Ink',base:'#1f2a44'},{name:'Bone',base:'#e8e1d3'},{name:'Moss',base:'#4f6b45'}]},
    {id:'breton', name:'Breton stripe tee', price:'Rs 1,800', type:'tee', pattern:'stripe',
      colors:[{name:'Navy stripe',base:'#efe9de',accent:'#1d2b53'},{name:'Red stripe',base:'#efe9de',accent:'#a3262f'}]},
    {id:'kurta', name:'Block-print kurta', price:'Rs 3,200', type:'kurta', pattern:'block',
      colors:[{name:'Madder',base:'#8e2834',accent:'#f0c56b'},{name:'Indigo',base:'#24376b',accent:'#e9e2cf'},{name:'Turmeric',base:'#d49a2a',accent:'#6b1f2a'}]},
    {id:'jacket', name:'Field jacket', price:'Rs 5,900', type:'jacket', pattern:'twill',
      colors:[{name:'Olive',base:'#5a6340'},{name:'Sand',base:'#b59b6d'},{name:'Black',base:'#232326'}]},
    {id:'dress', name:'Gingham sundress', price:'Rs 4,100', type:'dress', pattern:'check',
      colors:[{name:'Blue',base:'#f4efe6',accent:'#3d6b8f'},{name:'Rose',base:'#f6eee8',accent:'#c0566e'}]},
  ],
  bottoms: [
    {id:'jeans', name:'Straight jeans', price:'Rs 3,400', type:'pants', pattern:'denim',
      colors:[{name:'Mid wash',base:'#36557f'},{name:'Dark wash',base:'#1f2f4d'},{name:'Black',base:'#232428'}]},
    {id:'chino', name:'Stone chinos', price:'Rs 2,900', type:'pants', pattern:'twill',
      colors:[{name:'Stone',base:'#b7a684'},{name:'Navy',base:'#26314a'}]},
  ],
};
export function resetColours(){ for (const it of [...CATALOG.tops, ...CATALOG.bottoms]) it.ci = 0; }
resetColours();

export const OPTS = {
  tee:   {sh:.10,nw:.17,neck:.12,fit:.02,len:.12,flare:.04,curve:.02,swing:.25,sleeve:.5},
  kurta: {sh:.10,nw:.16,neck:.16,fit:.02,len:.78,flare:.20,curve:.08,swing:.9, sleeve:1.7},
  jacket:{sh:.13,nw:.18,neck:.06,fit:.03,len:.22,flare:.06,curve:.04,swing:.3, sleeve:1.92},
  dress: {sh:-.03,nw:.15,neck:.32,fit:.09,len:.95,flare:.50,curve:.10,swing:1,  sleeve:0},
};

