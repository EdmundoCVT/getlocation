// PDF construit à partir des données du dossier ; aucun DOM imprimé ni URL d'accès.
(function (global) {
  "use strict";
  const { PDFDocument, StandardFonts, rgb } = global.PDFLib;
  const W = 595.28, H = 841.89, M = 38, ink = rgb(.09,.16,.26), muted = rgb(.34,.41,.5), orange = rgb(1,.42,0), line = rgb(.85,.89,.93);
  const safe = value => String(value == null ? "" : value).replace(/[\r\n\t]+/g, " ").replace(/[\u2011\u2013\u2014]/g, "-").replace(/[^\u0020-\u007e\u00a0-\u00ff\u20ac]/g, "?");
  function wrap(font, value, size, width) {
    const result = []; let row = "";
    for (const word of safe(value).split(/\s+/)) {
      if (!word) continue;
      const next = row ? row + " " + word : word;
      if (font.widthOfTextAtSize(next, size) <= width) { row = next; continue; }
      if (row) result.push(row);
      row = "";
      for (const char of word) {
        if (font.widthOfTextAtSize(row + char, size) > width && row) { result.push(row); row = ""; }
        row += char;
      }
    }
    if (row) result.push(row);
    return result.length ? result : ["-"];
  }
  function write(page, font, value, x, y, size = 9, color = ink, width = W - M - x) {
    const rows = wrap(font, value, size, width);
    rows.forEach((row, i) => page.drawText(row, { x, y:y-i*(size+3), size, font, color }));
    return y-rows.length*(size+3);
  }
  function fit(image, x, y, width, height) {
    const ratio = Math.min(width/image.width, height/image.height), w = image.width*ratio, h = image.height*ratio;
    return { x:x+(width-w)/2, y:y+(height-h)/2, width:w, height:h };
  }
  async function picture(pdf, url) {
    const image = new Image(); image.src = url; await global.InspectionMedia.decode(image);
    const canvas = document.createElement("canvas"), scale = Math.min(1,1600/Math.max(image.naturalWidth,image.naturalHeight));
    canvas.width = Math.max(1,Math.round(image.naturalWidth*scale)); canvas.height = Math.max(1,Math.round(image.naturalHeight*scale));
    const ctx = canvas.getContext("2d"); ctx.fillStyle = "white"; ctx.fillRect(0,0,canvas.width,canvas.height); ctx.drawImage(image,0,0,canvas.width,canvas.height);
    const binary = atob(canvas.toDataURL("image/jpeg",.88).split(",")[1]);
    return pdf.embedJpg(Uint8Array.from(binary,c=>c.charCodeAt(0)));
  }
  global.InspectionDocument = {
    async generate(snapshot, cache) {
      const pdf = await PDFDocument.create(), regular = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
      const english = snapshot.language === "en";
      const T = value => !english ? value : ({
        "Etat des lieux du vehicule": "Vehicle condition report", "Informations (suite)": "Information (continued)",
        "Date et heure du constat": "Report date and time", "Agent": "Agent", "Kilometrage": "Odometer", "Carburant / charge": "Fuel / charge",
        "Cles": "Keys", "Accessoires": "Accessories", "Proprete exterieure": "Exterior cleanliness", "Proprete interieure": "Interior cleanliness", "Proprete chargement": "Cargo-area cleanliness",
        "Constat (suite)": "Report (continued)", "Dommages": "Damage", "Remarques": "Comments", "Aucun dommage renseigne.": "No damage recorded.", "Aucune remarque.": "No comments.",
        "Schema annote - ": "Annotated vehicle diagram - ", "Schema de reference - depart": "Reference diagram - departure", "Photos - ": "Photos - ",
        "Signatures": "Signatures", "SIGNATURES - ": "SIGNATURES - ", "LOCATAIRE": "RENTER", "Non renseigne": "Not provided", "Non renseignee": "Not provided", "Nom : ": "Name: ", "Date : ": "Date: ",
        "GET LOCATION - Etat des lieux": "GET LOCATION - Vehicle condition report", "Reperes numerotes correspondant a la liste des dommages.": "Numbered markers correspond to the damage list.",
        "Present au depart": "Present at departure", "Nouveau au retour": "New at return", "Au depart": "At departure", "Sans description": "No description", "depart": "departure", "retour": "return"
      }[value] || value);
      const modeLabel = mode => T(mode === "retour" ? "retour" : "depart");
      pdf.setTitle("Etat des lieux GET LOCATION - "+snapshot.reference); pdf.setAuthor("GET LOCATION");
      const date = global.InspectionMedia.date, stage = snapshot.stage, caption = snapshot.reference+" - "+modeLabel(snapshot.mode).toUpperCase();
      const make = (title, sub = caption) => {
        const page = pdf.addPage([W,H]);
        page.drawText("GET LOCATION",{x:M,y:H-M,font:bold,size:16,color:orange});
        write(page,bold,title,M,H-M-32,16);
        write(page,bold,sub,M,H-M-51,9,muted);
        page.drawLine({start:{x:M,y:H-M-62},end:{x:W-M,y:H-M-62},thickness:1,color:line});
        return {page,y:H-M-84};
      };
      let {page:first,y} = make(T("Etat des lieux du vehicule"));
      const fields = [...snapshot.summary,[T("Date et heure du constat"),date(stage.dateHeure)],[T("Agent"),stage.agent],[T("Kilometrage"),stage.km == null ? "" : stage.km+" km"],[T("Carburant / charge"),stage.carburant == null ? "" : stage.carburant+" %"],[T("Cles"),stage.cles],[T("Accessoires"),stage.clesAccessoires],[T("Proprete exterieure"),stage.propreteExterieure == null ? stage.proprete : stage.propreteExterieure+" / 5"],[T("Proprete interieure"),stage.propreteInterieure == null ? stage.proprete : stage.propreteInterieure+" / 5"],[T("Proprete chargement"),stage.propreteChargement == null ? "" : stage.propreteChargement+" / 5"]].filter(([,v])=>v!==""&&v!=null);
      for (let i=0;i<fields.length;i+=2) {
        const pair = fields.slice(i,i+2), height = Math.max(27,...pair.map(([,v])=>wrap(bold,v,9,232).length*12+14));
        if (y-height<150) ({page:first,y}=make(T("Informations (suite)")));
        pair.forEach(([label,value],col)=>{const x=M+col*265;write(first,regular,label,x,y,7.5,muted,232);write(first,bold,value,x,y-13,9,ink,232);});
        y-=height+5;
      }
      const rows = [];
      if (snapshot.mode==="retour"&&snapshot.depart) (snapshot.depart.marks||[]).forEach(mark=>rows.push({mark,status:T("Present au depart")}));
      (stage.marks||[]).forEach(mark=>rows.push({mark,status:snapshot.mode==="retour"?T("Nouveau au retour"):T("Au depart")}));
      function block(title,values) {
        if (y<105) ({page:first,y}=make(T("Constat (suite)")));
        y=write(first,bold,title,M,y-5,11)-4;
        for (const value of values) {
          if (y-wrap(regular,value,8.5,W-2*M).length*11<52) ({page:first,y}=make(T("Constat (suite)")));
          y=write(first,regular,value,M,y,8.5)-4;
        }
      }
      block(T("Dommages"),rows.length?rows.map(({mark,status},i)=>{
        const type=global.InspectionSketch.TYPES.find(t=>t.id===mark.type);
        return (i+1)+". "+status+" - "+(type?type.label:mark.type)+" - "+global.InspectionSketch.labelFor(mark.view)+" : "+(mark.description||T("Sans description"));
      }):[T("Aucun dommage renseigne.")]);
      block(T("Remarques"),[stage.dommages||T("Aucune remarque.")]);
      async function sketch(title,value) {
        const {page}=make(title);
        for (const [i,view] of global.InspectionSketch.VIEWS.entries()) {
          const top=i<4?690-Math.floor(i/2)*174:350, x=i<4?M+(i%2)*265:(W-170)/2, width=i<4?245:170, height=i<4?142:278;
          write(page,bold,view.label,x,top+18,9);
          const response=await fetch(view.asset); if(!response.ok) throw new Error("Schema vehicule indisponible.");
          const source=await pdf.embedPng(await response.arrayBuffer()), box=fit(source,x,top-height,width,height);
          page.drawImage(source,box);
          (value.marks||[]).forEach((mark,index)=>{
            if(mark.view!==view.key)return;
            const mx=box.x+Math.min(100,Math.max(0,Number(mark.x)||0))/100*box.width;
            const my=box.y+(1-Math.min(100,Math.max(0,Number(mark.y)||0))/100)*box.height;
            page.drawCircle({x:mx,y:my,size:9,color:orange,borderColor:rgb(1,1,1),borderWidth:1});
            const number=String(index+1);page.drawText(number,{x:mx-bold.widthOfTextAtSize(number,8)/2,y:my-3,font:bold,size:8,color:rgb(1,1,1)});
          });
        }
        write(page,regular,"Reperes numerotes correspondant a la liste des dommages.",M,61,8,muted);
      }
      await sketch(T("Schema annote - ")+modeLabel(snapshot.mode),stage);
      if(snapshot.mode==="retour"&&snapshot.depart) await sketch(T("Schema de reference - depart"),snapshot.depart);
      let photoPage=null, photoY=0, count=0;
      async function photos(items,title) {
        if(!items.length)return;
        // A new stage always starts under its own heading; never mix departure
        // and return photos under a misleading page title.
        if(photoPage&&count){photoPage=null;count=0;}
        for(const item of items) {
          if(!photoPage||count>=9) {const sheet=make("Photos - "+title);photoPage=sheet.page;photoY=sheet.y;count=0;}
          const col=count%3,row=Math.floor(count/3),x=M+col*176,top=photoY-row*156;
          const source=await picture(pdf,await cache.get(item));
          photoPage.drawRectangle({x,y:top-112,width:163,height:108,color:rgb(.96,.97,.98)});
          photoPage.drawImage(source,fit(source,x+2,top-110,159,104));
          write(photoPage,bold,(title+" - "+(global.InspectionMedia.labels[item.slot]||item.label||"Photo")),x,top-124,8,ink,160);
          write(photoPage,regular,date(item.capturedAt||item.dateHeure),x,top-141,7.5,muted,160);
          count++;
        }
      }
      if(snapshot.mode==="retour"){await photos(snapshot.departPhotos,modeLabel("depart"));await photos(snapshot.photos,modeLabel("retour"));}
      else await photos(snapshot.photos,modeLabel("depart"));
      const remaining=photoPage?photoY-Math.ceil(count/3)*156:0;
      let signPage,signY;
      if(!photoPage||remaining<205) {const sheet=make(T("Signatures"));signPage=sheet.page;signY=sheet.y;}
      else {signPage=photoPage;signY=remaining-20;}
      write(signPage,bold,T("SIGNATURES - ")+modeLabel(snapshot.mode).toUpperCase(),M,signY,11,orange);
      for(const [index,role] of ["client","agence"].entries()) {
        const value=stage.signatures&&stage.signatures[role],x=M+index*265,top=signY-18;
        signPage.drawRectangle({x,y:top-125,width:245,height:120,borderColor:line,borderWidth:1});
        write(signPage,bold,role==="client"?T("LOCATAIRE"):"GET LOCATION",x+9,top-18,9);
        write(signPage,regular,T("Nom : ")+(value&&value.name||T("Non renseigne")),x+9,top-35,8,ink,225);
        write(signPage,regular,T("Date : ")+(value&&value.signedAt?date(value.signedAt):T("Non renseignee")),x+9,top-49,8,ink,225);
        if(value&&value.imageDataUrl){const image=await picture(pdf,value.imageDataUrl);signPage.drawImage(image,fit(image,x+9,top-116,227,61));}
      }
      pdf.getPages().forEach((page,index)=>{
        page.drawLine({start:{x:M,y:29},end:{x:W-M,y:29},thickness:.7,color:line});
        page.drawText(T("GET LOCATION - Etat des lieux"),{x:M,y:16,font:regular,size:7,color:muted});
        page.drawText((index+1)+" / "+pdf.getPageCount(),{x:W-M-34,y:16,font:regular,size:7,color:muted});
      });
      return pdf.save();
    },
    async download(snapshot,cache) {
      const data=await this.generate(snapshot,cache),url=URL.createObjectURL(new Blob([data],{type:"application/pdf"}));
      const link=document.createElement("a");link.href=url;link.download="etat-des-lieux-"+snapshot.mode+"-"+String(snapshot.reference).replace(/[^a-zA-Z0-9-]/g,"-")+".pdf";
      document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
      return data;
    }
  };
}(window));
