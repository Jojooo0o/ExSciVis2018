#version 150
//#extension GL_ARB_shading_language_420pack : require
#extension GL_ARB_explicit_attrib_location : require

#define TASK 10
#define ENABLE_OPACITY_CORRECTION 0
#define ENABLE_LIGHTNING 0
#define ENABLE_SHADOWING 0

in vec3 ray_entry_position;

layout(location = 0) out vec4 FragColor;

uniform mat4 Modelview;

uniform sampler3D volume_texture;
uniform sampler2D transfer_texture;


uniform vec3    camera_location;
uniform float   sampling_distance;
uniform float   sampling_distance_ref;
uniform float   iso_value;
uniform vec3    max_bounds;
uniform ivec3   volume_dimensions;

uniform vec3    light_position;
uniform vec3    light_ambient_color;
uniform vec3    light_diffuse_color;
uniform vec3    light_specular_color;
uniform float   light_ref_coef;


bool
inside_volume_bounds(const in vec3 sampling_position) {
    return (   all(greaterThanEqual(sampling_position, vec3(0.0)))
            && all(lessThanEqual(sampling_position, max_bounds)));
}


float
get_sample_data(vec3 in_sampling_pos) {
    vec3 obj_to_tex = vec3(1.0) / max_bounds;
    return texture(volume_texture, in_sampling_pos * obj_to_tex).r;

}

vec3
get_gradient(vec3 sampling_pos) {
  // Central Difference: Dx = ( f(x+1, y, z) - f(x-1, y, z)) / 2
  vec3 dir = max_bounds / volume_dimensions;

  float Dx = (get_sample_data(vec3(sampling_pos.x + dir.x, sampling_pos.yz)) - get_sample_data(vec3(sampling_pos.x - dir.x, sampling_pos.yz))) / 2;
  float Dy = (get_sample_data(vec3(sampling_pos.x, sampling_pos.y + dir.y, sampling_pos.z)) - get_sample_data(vec3(sampling_pos.x, sampling_pos.y - dir.y, sampling_pos.z))) / 2;
  float Dz = (get_sample_data(vec3(sampling_pos.xy, sampling_pos.z + dir.z)) - get_sample_data(vec3(sampling_pos.xy, sampling_pos.z - dir.z))) / 2;

  return vec3(Dx, Dy, Dz);
}

void main() {
    /// One step trough the volume
    vec3 ray_increment      = normalize(ray_entry_position - camera_location) * sampling_distance;
    /// Position in Volume
    vec3 sampling_pos       = ray_entry_position + ray_increment; // test, increment just to be sure we are in the volume

    /// Init color of fragment
    vec4 dst = vec4(0.0, 0.0, 0.0, 0.0);

    /// check if we are inside volume
    bool inside_volume = inside_volume_bounds(sampling_pos);

    if (!inside_volume)
        discard;

#if TASK == 10
    // maximum intensity projection
    vec4 max_val = vec4(0.0, 0.0, 0.0, 0.0);

    // the traversal loop,
    // termination when the sampling position is outside volume boundarys
    // another termination condition for early ray termination is added
    while (inside_volume) {
        // get sample
        float s = get_sample_data(sampling_pos);

        // apply the transfer functions to retrieve color and opacity
        vec4 color = texture(transfer_texture, vec2(s, s));

        // this is the example for maximum intensity projection
        max_val.r = max(color.r, max_val.r);
        max_val.g = max(color.g, max_val.g);
        max_val.b = max(color.b, max_val.b);
        max_val.a = max(color.a, max_val.a);

        // increment the ray sampling position
        sampling_pos  += ray_increment;

        // update the loop termination condition
        inside_volume  = inside_volume_bounds(sampling_pos);
    }

    dst = max_val;

#endif

#if TASK == 11
    // average intensity projection
    vec4 avg_color = vec4(0.0, 0.0, 0.0, 0.0);
    int counter = 0;

    // the traversal loop,
    // termination when the sampling position is outside volume boundarys
    // another termination condition for early ray termination is added
    while (inside_volume) {
        // get sample
        float s = get_sample_data(sampling_pos);

        // apply the transfer functions to retrieve color and opacity
        vec4 color = texture(transfer_texture, vec2(s, s));

        // avg calc
        avg_color += color;

        // increment the ray sampling position
        sampling_pos  += ray_increment;

        // update the loop termination condition
        inside_volume  = inside_volume_bounds(sampling_pos);

        counter++;
    }

    dst = avg_color / counter;

#endif

#if TASK == 12 || TASK == 13
    vec3 prev_sampling_pos;
    bool  binary  = false;
    float epsilon = 0.0001; // threshold for floating point operations

    // the traversal loop,
    // termination when the sampling position is outside volume boundarys
    // another termination condition for early ray termination is added
    while (inside_volume) {
        // get sample
        float s = get_sample_data(sampling_pos);
        prev_sampling_pos = sampling_pos; // save sampling pos for binary search

        if (TASK == 13)
          binary = true;

        // first-hit isosurface
        if (s > iso_value && !binary) {
          dst = texture(transfer_texture, vec2(s, s));
          break;
        }

        // increment the ray sampling position
        sampling_pos += ray_increment;


#if TASK == 13 // Binary Search
        float next_sample = get_sample_data(sampling_pos); // get next sample

        if (s <= iso_value && next_sample >= iso_value) {
          vec3 start_pos = prev_sampling_pos;
          vec3 end_pos   = sampling_pos;
          vec3 mid_pos;
          int iterations = 0;
          bool in_shadow = false;

          while(iterations <= 64) {
            mid_pos = start_pos + (end_pos-start_pos) / 2;

            float mid_sample = get_sample_data(mid_pos);
            float difference = mid_sample - iso_value;

            if (mid_sample == iso_value || iterations == 64 ||
                difference < epsilon && difference > -epsilon) {
              dst = texture(transfer_texture, vec2(mid_sample, mid_sample));
              break;
            }
            else if (mid_sample < iso_value) {
              start_pos = mid_pos;
            }
            else { // mid_sample > iso_value
              end_pos = mid_pos;
            }

            ++iterations;
          }

#if ENABLE_LIGHTNING == 1 // Add Shading
      if(!in_shadow) {
        vec3 normal = normalize(get_gradient(mid_pos)) * -1;
        vec3 light = normalize(light_position - mid_pos);
        float lambertian = max(dot(normal, light), 0.0);
        vec3 halfway  = normalize(light + normal);
        float specular_Angle = max(dot(halfway, normal), 0.0);
        float specular = 0.0;

        if(lambertian > 0.0) {
          specular = pow(specular_Angle, light_ref_coef);
        }

        dst = vec4(light_ambient_color + lambertian * light_diffuse_color + specular * light_specular_color, 1);
      }
#endif
#if ENABLE_SHADOWING == 1 // Add Shadows
  vec3 light_dir = normalize(light_position - mid_pos);
  vec3 shadow_step = light_dir * sampling_distance;
  float epsilon = 0.1;
  vec3 shadow_pos = mid_pos + shadow_step;
  float mid_sample = get_sample_data(mid_pos + shadow_step * epsilon);

  iterations = int(length(light_dir)/sampling_distance);
  int i = 0;

  while(i < iterations) {
    shadow_pos += shadow_step;
    float shadow_sample = get_sample_data(shadow_pos);
    ++i;

    if(shadow_sample < iso_value && mid_sample > iso_value || shadow_sample > iso_value && mid_sample < iso_value){
      dst = vec4(light_ambient_color, 1);
      break;
    }
  }

  in_shadow = true;
#endif
        break;
      }
#endif
        // update the loop termination condition
        inside_volume = inside_volume_bounds(sampling_pos);
    }
#endif


#if TASK == 31
    // the traversal loop,
    // termination when the sampling position is outside volume boundarys
    // another termination condition for early ray termination is added
    bool front_back = true; // front_to_back when true otherwise back_to_front compositing
    float transparency = 1.0;
    float epsilon = 0.0001; // threshold for floating point operations

    while (inside_volume) {

// Hack: button label changes when compositing is selected
#if ENABLE_SHADOWING == 0 // Front_to_Back compositing

      float s = get_sample_data(sampling_pos);
      vec4 color = texture(transfer_texture, vec2(s, s));

#if ENABLE_OPACITY_CORRECTION == 1 // Opacity Correction
        color.a = 1 - pow((1 - color.a), 255 * sampling_distance / sampling_distance_ref);
#endif

#if ENABLE_LIGHTNING == 1 // Add Shading
        vec3 normal = normalize(get_gradient(sampling_pos)) * -1;
        vec3 light = normalize(light_position - sampling_pos);
        float lambertian = max(dot(normal, light), 0.0);
        vec3 halfway  = normalize(light + normal);
        float specular_Angle = max(dot(halfway, normal), 0.0);
        float specular = 0.0;

        if(lambertian > 0.0) {
          specular = pow(specular_Angle, light_ref_coef);
        }

        dst.rgb += (light_ambient_color + lambertian * light_diffuse_color + specular * light_specular_color) * transparency * color.a;
#endif

        dst.rgb += color.rgb * transparency * color.a;
        transparency *= (1.0 - color.a);
        dst.a = 1.0 - transparency;

        if(transparency <= epsilon){
          break;
        }
#endif
        sampling_pos += ray_increment;
        // update the loop termination condition
        inside_volume = inside_volume_bounds(sampling_pos);
      }
      

#if ENABLE_SHADOWING == 1 // Back_to_Front compositing

        sampling_pos -= ray_increment; // step back to last position "inside_volume"
        inside_volume = inside_volume_bounds(sampling_pos);

        while(inside_volume) {
          float s = get_sample_data(sampling_pos);
          vec4 color = texture(transfer_texture, vec2(s, s));

#if ENABLE_OPACITY_CORRECTION == 1 // Opacity Correction
        color.a = 1 - pow((1 - color.a), 255 * sampling_distance / sampling_distance_ref);
#endif

#if ENABLE_LIGHTNING == 1 // Add Shading
          vec3 normal = normalize(get_gradient(sampling_pos)) * -1;
          vec3 light = normalize(light_position - sampling_pos);
          float lambertian = max(dot(normal, light), 0.0);
          vec3 halfway  = normalize(light + normal);
          float specular_Angle = max(dot(halfway, normal), 0.0);
          float specular = 0.0;

          if(lambertian > 0.0) {
            specular = pow(specular_Angle, light_ref_coef);
          }

          dst.rgb += (light_ambient_color + lambertian * light_diffuse_color + specular * light_specular_color) * transparency * color.a;
#endif

          dst.rgb = color.rgb * color.a + dst.rgb * (1.0 - color.a);
          dst.a += color.a;

          sampling_pos -= ray_increment;
          // update the loop termination condition
          inside_volume = inside_volume_bounds(sampling_pos);
        }
#endif

#endif

    // return the calculated color value
    FragColor = dst;
}
