import "server-only"
import {createCanvas,loadImage} from "@napi-rs/canvas"
/** White, bounded independent PNG. Original bytes are never written. */
export async function cropRegionImage(bytes:Uint8Array,box:{left:number;top:number;width:number;height:number}){
 if(!Object.values(box).every(Number.isSafeInteger)||box.left<0||box.top<0||box.width<8||box.height<8||box.width*box.height>4_000_000)throw new Error("REGION_CROP_INVALID")
 const image=await loadImage(Buffer.from(bytes))
 if(image.width*image.height>25_000_000||box.left+box.width>image.width||box.top+box.height>image.height)throw new Error("REGION_CROP_INVALID")
 const surface=createCanvas(box.width,box.height),ctx=surface.getContext("2d")
 ctx.fillStyle="#ffffff";ctx.fillRect(0,0,box.width,box.height);ctx.drawImage(image,box.left,box.top,box.width,box.height,0,0,box.width,box.height)
 const png=new Uint8Array(await surface.encode("png"))
 if(png.length>5_000_000)throw new Error("REGION_CROP_LIMIT")
 return png
}
